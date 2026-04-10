"""
Embedding Service — generates vector embeddings for text chunks.

Architecture:
    EmbeddingService (abstract)
        ├── OpenAIEmbeddingService  — calls text-embedding-3-small
        └── MockEmbeddingService   — returns zero vectors (tests / offline dev)

The factory function get_embedding_service() returns the right implementation
based on settings.EMBEDDING_PROVIDER.  RoundManager and DocumentIngestionService
always call through this interface, never a provider directly.

Vector dimension: 1536 (OpenAI text-embedding-3-small / ada-002 compatible).
This must match the Vector(1536) column in document_chunks.embedding.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 1536


class EmbeddingService(ABC):
    """Abstract embedding interface.  Returns a list of floats per text input."""

    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        """Embed a single text string.  Returns a vector of length EMBEDDING_DIM."""

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in one API call where the provider supports it."""


# ─────────────────────────────────────────────────────────────────────────────
# Concrete implementations
# ─────────────────────────────────────────────────────────────────────────────

class OpenAIEmbeddingService(EmbeddingService):
    """
    OpenAI text-embedding-3-small (1536-dim).

    Requires OPENAI_API_KEY.  Both embed() and embed_batch() use the async
    OpenAI client so they never block the event loop.
    """

    def __init__(self, api_key: str, model: str = "text-embedding-3-small") -> None:
        from openai import AsyncOpenAI  # deferred — not everyone has openai installed
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # Truncate very long strings — OAI limit is ~8191 tokens
        safe_texts = [t[:32000] for t in texts]
        response = await self._client.embeddings.create(
            model=self._model,
            input=safe_texts,
        )
        # Response items are ordered by index
        ordered = sorted(response.data, key=lambda d: d.index)
        return [item.embedding for item in ordered]


class MockEmbeddingService(EmbeddingService):
    """
    Zero-vector embeddings for tests and offline development.

    Does NOT call any API.  Retrieval results will all have similarity 1.0
    vs a zero query vector, so ordering is arbitrary — fine for testing.
    """

    async def embed(self, text: str) -> list[float]:
        _ = text  # consumed but unused
        return [0.0] * EMBEDDING_DIM

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] * EMBEDDING_DIM for _ in texts]


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────

_instance: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    """
    Return the singleton EmbeddingService instance.

    Selection:
      EMBEDDING_PROVIDER=openai  → OpenAIEmbeddingService (needs OPENAI_API_KEY)
      EMBEDDING_PROVIDER=mock    → MockEmbeddingService (default; no API key needed)
    Falls back to Mock with a warning if openai is selected but key is missing.
    """
    global _instance
    if _instance is None:
        _instance = _make_service()
    return _instance


def _make_service() -> EmbeddingService:
    from app.core.config import settings  # deferred — avoids circular import

    provider = settings.EMBEDDING_PROVIDER.lower()

    if provider == "openai" and settings.OPENAI_API_KEY:
        logger.info(
            "Embedding provider: OpenAI (model=%s, dim=%d)",
            settings.EMBEDDING_MODEL,
            settings.EMBEDDING_DIM,
        )
        return OpenAIEmbeddingService(
            api_key=settings.OPENAI_API_KEY,
            model=settings.EMBEDDING_MODEL,
        )

    if provider == "openai" and not settings.OPENAI_API_KEY:
        logger.warning(
            "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set. "
            "Falling back to MockEmbeddingService."
        )

    logger.info("Embedding provider: Mock (zero-vector, no API calls)")
    return MockEmbeddingService()
