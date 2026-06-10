"""
Retrieval Service — RAG hook for the Round Manager.

Performs cosine-similarity vector search over document_chunks.embedding using
pgvector's <=> (cosine distance) operator.  Chunks are scoped to the current
chat session so users only see context from their own uploaded documents.

Architecture:
    RoundManager._retrieve(ctx)
        → RetrievalService.retrieve(query, session_id, db, top_k)
            → EmbeddingService.embed(query)           # query vector
            → pgvector cosine distance query          # nearest chunks
            → list[RetrievedChunk]                    # typed results

The `db` session is injected by the caller.  RetrievalService itself is
stateless — instantiated once in RoundManager.__init__.

Graceful degradation:
    • No documents uploaded → empty list (debate proceeds without RAG context)
    • Embedding fails       → empty list with a warning (debate still runs)
    • DB error             → empty list with a warning
"""

from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import bindparam, select
from sqlalchemy.ext.asyncio import AsyncSession
from pgvector.sqlalchemy import Vector

from app.core.config import settings
from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.schemas.contracts import RetrievedChunk
from app.services.embeddings.embedding_service import (
    _validate_embedding_vector,
    EmbeddingProviderError,
    get_embedding_service,
)
from app.services.retrieval.router import RetrievalStrategy
from app.services.retrieval.diversity import apply_strategy

logger = logging.getLogger(__name__)

# Minimum similarity threshold — chunks below this score are excluded.
# Lowered to 0.20 to support cross-lingual queries (e.g. English question vs Korean doc).
_MIN_SIMILARITY = 0.20

# Keyword-fallback tuning.
_KEYWORD_CANDIDATE_CAP = 600   # max chunks scanned in the keyword pass (bounded memory)
_KEYWORD_MIN_TOKEN_LEN = 2     # ignore 1-char tokens
# Very common words carry no retrieval signal — drop them from the query.
_KEYWORD_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of",
    "to", "in", "on", "at", "by", "is", "are", "was", "were", "be", "been",
    "it", "its", "this", "that", "these", "those", "as", "with", "from",
    "which", "who", "whom", "what", "when", "where", "why", "how", "do",
    "does", "did", "can", "could", "should", "would", "will", "shall", "may",
    "i", "you", "he", "she", "we", "they", "their", "your", "our", "my",
    "better", "best", "vs", "versus", "between", "about", "into", "than",
})
_TOKEN_RE = re.compile(r"[^\W\d_]+|\d+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    """Lower-cased word/number tokens. Unicode-aware (keeps CJK/Cyrillic)."""
    if not text:
        return []
    return [t.lower() for t in _TOKEN_RE.findall(text)]


class RetrievalService:
    """
    Retrieves relevant document chunks via pgvector cosine similarity search.

    Scopes retrieval to the user's session so cross-user data leakage is impossible.
    Falls back gracefully to an empty list when no documents are available.
    """

    async def retrieve(
        self,
        query: str,
        session_id: uuid.UUID,
        db: AsyncSession,
        top_k: int = 3,
    ) -> list[RetrievedChunk]:
        """
        Retrieve the top-k most relevant chunks for the query (session-wide).
        Legacy entry point — equivalent to shared_session_docs mode.
        """
        return await self._retrieve_impl(
            query=query,
            session_id=session_id,
            db=db,
            top_k=top_k,
            document_ids=None,
        )

    async def retrieve_for_agent(
        self,
        agent_id: uuid.UUID,
        session_id: uuid.UUID,
        query: str,
        db: AsyncSession,
        knowledge_mode: str = "shared_session_docs",
        assigned_document_ids: list[uuid.UUID] | None = None,
        top_k: int = 3,
        strategy: RetrievalStrategy | None = None,
    ) -> list[RetrievedChunk]:
        """
        Agent-aware retrieval — respects the agent's knowledge configuration.

        Args:
            agent_id:              The agent requesting retrieval.
            session_id:            Current session scope.
            query:                 The query text.
            db:                    Async SQLAlchemy session.
            knowledge_mode:        "no_docs" | "shared_session_docs" | "assigned_docs_only"
            assigned_document_ids: Document IDs bound to this agent (used when mode == assigned_docs_only).
            top_k:                 Max chunks to return.
            strategy:              Step 31 — optional per-role retrieval strategy.
                                   When provided, the candidate pool is widened
                                   (top_k × ``candidate_multiplier``), then re-ranked
                                   with role keyword boost + source balance + MMR
                                   diversity, and trimmed back to ``top_k``.
        """
        if knowledge_mode == "no_docs":
            logger.debug(
                "RetrievalService: agent %s has knowledge_mode=no_docs — skipping retrieval",
                agent_id,
            )
            return []

        if knowledge_mode == "assigned_docs_only":
            if not assigned_document_ids:
                logger.debug(
                    "RetrievalService: agent %s has assigned_docs_only but no documents — skipping",
                    agent_id,
                )
                return []
            return await self._retrieve_impl(
                query=query,
                session_id=session_id,
                db=db,
                top_k=top_k,
                document_ids=assigned_document_ids,
                strategy=strategy,
            )

        # Default: shared_session_docs — retrieve from all session documents
        return await self._retrieve_impl(
            query=query,
            session_id=session_id,
            db=db,
            top_k=top_k,
            document_ids=None,
            strategy=strategy,
        )

    async def _retrieve_impl(
        self,
        query: str,
        session_id: uuid.UUID,
        db: AsyncSession,
        top_k: int,
        document_ids: list[uuid.UUID] | None,
        strategy: RetrievalStrategy | None = None,
    ) -> list[RetrievedChunk]:
        """
        Core retrieval implementation.

        Args:
            query:        The text to match against stored embeddings.
            session_id:   Scopes retrieval to documents uploaded in this session.
            db:           Async SQLAlchemy session.
            top_k:        Maximum number of chunks to return.
            document_ids: If provided, restrict retrieval to only these document IDs.

        Returns:
            List of RetrievedChunk ordered by similarity descending.
            Empty list whenever no context is available (safe fallback).
        """
        # ── 1. Check there are ready documents for this session ───────────────
        if not await self._has_ready_documents(db, session_id, document_ids):
            logger.debug(
                "RetrievalService: no ready documents for session %s (scope=%s) — skipping retrieval",
                session_id,
                "filtered" if document_ids else "all",
            )
            return []

        # Step 31: when a strategy is provided, widen the candidate pool by
        # ``candidate_multiplier`` so the diversity / role-bias re-ranker has
        # something to choose from. We still cap and trim to ``top_k`` after.
        sql_limit = top_k
        if strategy is not None and strategy.candidate_multiplier > 1:
            sql_limit = max(top_k, top_k * strategy.candidate_multiplier)

        # ── 2. Primary path: semantic vector search ───────────────────────────
        chunks, vector_available = await self._vector_search(
            query, session_id, db, sql_limit, document_ids
        )
        mode = "vector"

        # ── 3. Fallback path: keyword search ──────────────────────────────────
        # Triggered when embeddings are unavailable (provider down / mock /
        # not yet computed) OR when vector search found nothing. This is what
        # keeps RAG working when the embedding provider is misconfigured — the
        # chunk text is always stored, so lexical matching still returns sources.
        if not chunks:
            keyword_chunks = await self._keyword_search(
                query, session_id, db, sql_limit, document_ids
            )
            if keyword_chunks:
                chunks = keyword_chunks
                mode = "keyword"
            elif not vector_available:
                mode = "keyword"

        raw_count = len(chunks)

        # ── 4. Step 31: apply role-aware re-ranking (when a strategy is set).
        if strategy is not None and chunks:
            chunks = apply_strategy(chunks, strategy, top_k=top_k)
        elif len(chunks) > top_k:
            chunks = chunks[:top_k]

        top_sims = [round(c.similarity_score, 4) for c in chunks[:3]]
        source_files = sorted({str(c.document_id) for c in chunks})
        logger.info(
            "[RAG Retrieve] session=%s mode=%s query=%r raw=%d final=%d "
            "strategy=%s top_scores=%s docs=%d",
            session_id,
            mode,
            query[:120],
            raw_count,
            len(chunks),
            strategy.name if strategy else "none",
            top_sims,
            len(source_files),
        )
        return chunks

    async def _has_ready_documents(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        document_ids: list[uuid.UUID] | None,
    ) -> bool:
        """True when the session (optionally scoped to ``document_ids``) has at
        least one ``ready`` document."""
        stmt = (
            select(Document.id)
            .where(Document.chat_session_id == session_id)
            .where(Document.status == DocumentStatus.ready)
        )
        if document_ids is not None:
            stmt = stmt.where(Document.id.in_(document_ids))
        stmt = stmt.limit(1)
        result = await db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def _vector_search(
        self,
        query: str,
        session_id: uuid.UUID,
        db: AsyncSession,
        sql_limit: int,
        document_ids: list[uuid.UUID] | None,
    ) -> tuple[list[RetrievedChunk], bool]:
        """Semantic search over stored embeddings.

        Returns ``(chunks, available)`` where ``available`` is False when the
        embedding provider/query vector/pgvector query was unusable — the
        caller then switches to keyword fallback. Never raises.
        """
        # Constructing the provider can itself raise (e.g. missing API key for
        # the configured provider). Treat that exactly like an embedding failure
        # — fall back to keyword search rather than crashing retrieval.
        try:
            embedding_svc = get_embedding_service()
            provider_name = type(embedding_svc).__name__
            query_vector = await embedding_svc.embed(query)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[RAG Retrieve] embedding unavailable: %s — using keyword fallback",
                exc,
            )
            return [], False

        # Validate strictly — a bad vector (wrong dim, NaN/Inf) silently breaks
        # cosine similarity at the SQL layer.
        try:
            query_vector = _validate_embedding_vector(
                query_vector,
                settings.EMBEDDING_DIM,
                context=f"RetrievalService query vector ({provider_name})",
            )
        except EmbeddingProviderError as exc:
            logger.warning(
                "[RAG Retrieve] invalid query vector from %s: %s — using keyword fallback",
                provider_name, exc,
            )
            return [], False

        # All-zero vector ⇒ MockEmbeddingService / unconfigured provider. Cosine
        # distance is undefined, so vectors are unusable — fall back to keyword.
        if not any(v != 0.0 for v in query_vector):
            logger.info(
                "[RAG Retrieve] query vector from %s is all-zeros — using keyword fallback",
                provider_name,
            )
            return [], False

        try:
            # Bind the vector as a typed parameter — pgvector adapts it to the
            # ``vector`` SQL type (no SQL-injection surface).
            qv_param = bindparam("qv", value=query_vector, type_=Vector(settings.EMBEDDING_DIM))
            distance_expr = DocumentChunk.embedding.cosine_distance(qv_param)
            stmt = (
                select(
                    DocumentChunk.id,
                    DocumentChunk.document_id,
                    DocumentChunk.chunk_index,
                    DocumentChunk.content,
                    (1 - distance_expr).label("similarity"),
                )
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(Document.chat_session_id == session_id)
                .where(Document.status == DocumentStatus.ready)
                .where(DocumentChunk.embedding.is_not(None))
                .where(distance_expr < (1 - _MIN_SIMILARITY))
            )
            if document_ids is not None:
                stmt = stmt.where(Document.id.in_(document_ids))
            stmt = stmt.order_by(distance_expr).limit(sql_limit)
            
            # Wrap the actual DB execution in a savepoint so that if it fails
            # (e.g. pgvector not installed), the parent transaction is not aborted.
            async with db.begin_nested():
                rows = await db.execute(stmt)
                results = rows.all()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[RAG Retrieve] pgvector query failed for session %s: %s — using keyword fallback",
                session_id, exc,
            )
            return [], False

        chunks = [
            RetrievedChunk(
                chunk_id=row.id,
                document_id=row.document_id,
                chunk_index=row.chunk_index,
                content=row.content,
                similarity_score=float(row.similarity),
            )
            for row in results
        ]
        return chunks, True

    async def _keyword_search(
        self,
        query: str,
        session_id: uuid.UUID,
        db: AsyncSession,
        limit: int,
        document_ids: list[uuid.UUID] | None,
    ) -> list[RetrievedChunk]:
        """Lexical fallback over stored chunk text. Never raises.

        Tokenises the query, scores each candidate chunk by query-token
        coverage plus a light term-frequency bonus, and returns the best
        ``limit`` chunks (only those with non-zero overlap). Works on any DB
        (no pgvector needed) and on documents whose embeddings failed/disabled.
        """
        q_tokens = [
            t for t in _tokenize(query)
            if len(t) >= _KEYWORD_MIN_TOKEN_LEN and t not in _KEYWORD_STOPWORDS
        ]
        if not q_tokens:
            return []
        q_set = set(q_tokens)

        try:
            stmt = (
                select(
                    DocumentChunk.id,
                    DocumentChunk.document_id,
                    DocumentChunk.chunk_index,
                    DocumentChunk.content,
                )
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(Document.chat_session_id == session_id)
                .where(Document.status == DocumentStatus.ready)
            )
            if document_ids is not None:
                stmt = stmt.where(Document.id.in_(document_ids))
            stmt = stmt.limit(_KEYWORD_CANDIDATE_CAP)
            async with db.begin_nested():
                rows = (await db.execute(stmt)).all()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[RAG Retrieve] keyword query failed for session %s: %s — returning empty",
                session_id, exc,
            )
            return []

        scored: list[tuple[float, object]] = []
        for row in rows:
            tokens = _tokenize(row.content or "")
            if not tokens:
                continue
            token_set = set(tokens)
            overlap = q_set & token_set
            if not overlap:
                continue
            coverage = len(overlap) / len(q_set)
            matched_terms = sum(1 for t in tokens if t in q_set)
            density = matched_terms / len(tokens)
            # Coverage dominates; density gives a small boost to chunks that
            # mention the query terms repeatedly. Bounded to [0, 1].
            score = min(1.0, 0.7 * coverage + 0.3 * min(1.0, density * 5.0))
            scored.append((score, row))

        if not scored:
            return []

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            RetrievedChunk(
                chunk_id=row.id,
                document_id=row.document_id,
                chunk_index=row.chunk_index,
                content=row.content,
                similarity_score=round(float(score), 4),
            )
            for score, row in scored[:limit]
        ]

