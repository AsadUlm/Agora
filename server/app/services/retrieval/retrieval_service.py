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
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.schemas.contracts import RetrievedChunk
from app.services.embeddings.embedding_service import get_embedding_service

logger = logging.getLogger(__name__)

# Minimum similarity threshold — chunks below this score are excluded.
# cos_distance = 1 - cosine_similarity, so distance < 0.45 means similarity > 0.55.
_MIN_SIMILARITY = 0.45


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
            )

        # Default: shared_session_docs — retrieve from all session documents
        return await self._retrieve_impl(
            query=query,
            session_id=session_id,
            db=db,
            top_k=top_k,
            document_ids=None,
        )

    async def _retrieve_impl(
        self,
        query: str,
        session_id: uuid.UUID,
        db: AsyncSession,
        top_k: int,
        document_ids: list[uuid.UUID] | None,
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
        ready_check_stmt = (
            select(Document.id)
            .where(Document.chat_session_id == session_id)
            .where(Document.status == DocumentStatus.ready)
        )
        if document_ids is not None:
            ready_check_stmt = ready_check_stmt.where(Document.id.in_(document_ids))
        ready_check_stmt = ready_check_stmt.limit(1)

        ready_check = await db.execute(ready_check_stmt)
        if ready_check.scalar_one_or_none() is None:
            logger.debug(
                "RetrievalService: no ready documents for session %s (scope=%s) — skipping retrieval",
                session_id,
                "filtered" if document_ids else "all",
            )
            return []

        # ── 2. Embed the query ────────────────────────────────────────────────
        embedding_svc = get_embedding_service()
        try:
            query_vector = await embedding_svc.embed(query)
        except Exception as exc:
            logger.warning(
                "RetrievalService: embedding failed for query (%r): %s — returning empty",
                query[:60],
                exc,
            )
            return []

        # ── 3. pgvector cosine distance query ─────────────────────────────────
        # Cosine distance = 1 - cosine_similarity.  Lower is more similar.
        # We filter by distance < (1 - _MIN_SIMILARITY) so only genuinely
        # relevant chunks are returned.
        try:
            vector_literal = f"[{','.join(str(v) for v in query_vector)}]"
            stmt = (
                select(
                    DocumentChunk.id,
                    DocumentChunk.document_id,
                    DocumentChunk.chunk_index,
                    DocumentChunk.content,
                    (
                        text(f"1 - (document_chunks.embedding <=> '{vector_literal}'::vector)")
                    ).label("similarity"),
                )
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(Document.chat_session_id == session_id)
                .where(Document.status == DocumentStatus.ready)
                .where(DocumentChunk.embedding.is_not(None))
                .where(
                    text(f"document_chunks.embedding <=> '{vector_literal}'::vector < {1 - _MIN_SIMILARITY}")
                )
            )
            if document_ids is not None:
                stmt = stmt.where(Document.id.in_(document_ids))
            stmt = (
                stmt
                .order_by(text(f"document_chunks.embedding <=> '{vector_literal}'::vector"))
                .limit(top_k)
            )
            rows = await db.execute(stmt)
            results = rows.all()
        except Exception as exc:
            logger.warning(
                "RetrievalService: pgvector query failed for session %s: %s — returning empty",
                session_id,
                exc,
            )
            return []

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

        logger.info(
            "RetrievalService: %d chunks retrieved for session %s (query=%r)",
            len(chunks),
            session_id,
            query[:60],
        )
        return chunks
