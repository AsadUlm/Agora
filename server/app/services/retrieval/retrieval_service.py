"""
Retrieval Service — RAG hook for the Round Manager.

Step 2: Returns empty list (stub).
Step 5: Will query pgvector for relevant document_chunks given the query.

Architecture contract:
  RoundManager calls retrieve() BEFORE each LLM call so retrieved context
  can be injected into prompts. The interface is stable — Step 5 fills the
  implementation without touching the Round Manager.
"""

from __future__ import annotations

import logging
import uuid

from app.schemas.contracts import RetrievedChunk

logger = logging.getLogger(__name__)


class RetrievalService:
    """
    Interface for retrieving relevant document chunks via vector similarity.

    Current implementation: stub — always returns empty list.
    Step 5 will add pgvector cosine similarity search here.
    """

    async def retrieve(
        self,
        query: str,
        session_id: uuid.UUID,
        top_k: int = 5,
    ) -> list[RetrievedChunk]:
        """
        Retrieve the top-k most relevant chunks for the query.

        Args:
            query:      The text to match against stored embeddings.
            session_id: Scopes retrieval to documents uploaded in this session.
            top_k:      Maximum number of chunks to return.

        Returns:
            List of RetrievedChunk, ordered by similarity descending.
            Empty list when no documents are available (current stub behaviour).
        """
        # Step 5: replace with:
        #   embedding = await embed_service.embed(query)
        #   chunks = await db.execute(
        #       select(DocumentChunk)
        #       .join(Document)
        #       .where(Document.chat_session_id == session_id)
        #       .order_by(DocumentChunk.embedding.cosine_distance(embedding))
        #       .limit(top_k)
        #   )
        #   return [RetrievedChunk(...) for chunk in chunks]
        logger.debug(
            "RetrievalService.retrieve called (stub): query=%r session=%s",
            query[:60],
            session_id,
        )
        return []
