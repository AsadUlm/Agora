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
        top_k: int = 5,
    ) -> list[RetrievedChunk]:
        """
        Retrieve the top-k most relevant chunks for the query.

        Args:
            query:      The text to match against stored embeddings.
            session_id: Scopes retrieval to documents uploaded in this session.
            db:         Async SQLAlchemy session.
            top_k:      Maximum number of chunks to return.

        Returns:
            List of RetrievedChunk ordered by similarity descending.
            Empty list whenever no context is available (safe fallback).
        """
        # ── 1. Check there are ready documents for this session ───────────────
        ready_check = await db.execute(
            select(Document.id)
            .where(Document.chat_session_id == session_id)
            .where(Document.status == DocumentStatus.ready)
            .limit(1)
        )
        if ready_check.scalar_one_or_none() is None:
            logger.debug(
                "RetrievalService: no ready documents for session %s — skipping retrieval",
                session_id,
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

