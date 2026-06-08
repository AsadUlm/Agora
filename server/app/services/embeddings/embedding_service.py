"""
Embedding Service — generates vector embeddings for text chunks.

Architecture:
    EmbeddingService (abstract)
        ├── OpenRouterEmbeddingService — POST /embeddings on OpenRouter
        ├── OpenAIEmbeddingService     — calls text-embedding-3-small
        └── MockEmbeddingService       — returns zero vectors (tests / offline dev)

The factory function get_embedding_service() returns the right implementation
based on settings.EMBEDDING_PROVIDER.  RoundManager and DocumentIngestionService
always call through this interface, never a provider directly.

Vector dimension: 768 (Gemini text-embedding-004 compatible).
This must match the Vector(768) column in document_chunks.embedding.
"""

from __future__ import annotations

import logging
import math
import os
from abc import ABC, abstractmethod
from typing import Any, Sequence

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 768


class EmbeddingProviderError(RuntimeError):
    """Raised when an embedding provider fails in a non-retryable way."""


def _validate_embedding_vector(
    vector: Any,
    expected_dim: int,
    *,
    context: str = "embedding",
) -> list[float]:
    """
    Strict shape/value check for a single embedding vector.

    Raises EmbeddingProviderError on:
      • not a list/tuple
      • wrong length
      • non-numeric element
      • NaN or +/- Inf

    Returns the vector coerced to list[float].
    """
    if not isinstance(vector, (list, tuple)):
        raise EmbeddingProviderError(
            f"{context}: expected list/tuple, got {type(vector).__name__}"
        )
    if len(vector) != expected_dim:
        raise EmbeddingProviderError(
            f"{context}: expected dim={expected_dim}, got {len(vector)}"
        )
    out: list[float] = []
    for i, v in enumerate(vector):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise EmbeddingProviderError(
                f"{context}: non-numeric value at index {i}: {type(v).__name__}"
            )
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            raise EmbeddingProviderError(
                f"{context}: NaN/Inf value at index {i}"
            )
        out.append(f)
    return out


def _is_test_environment() -> bool:
    """True when running under pytest or APP_ENV is set to a test value."""
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    try:
        from app.core.config import settings  # deferred
        return settings.APP_ENV.lower() in {"test", "testing", "ci"}
    except Exception:  # pragma: no cover — defensive
        return False


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
    OpenAI text-embedding-3-small.

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


class OpenRouterEmbeddingService(EmbeddingService):
    """
    OpenRouter-routed embeddings.

    Posts to ``{base_url}/embeddings`` with an OpenAI-compatible payload:

        {
          "model": "openai/text-embedding-3-small",
          "input": ["text 1", "text 2"],
          "dimensions": 768
        }

    Returns vectors in the original input order (sorted by ``index`` if
    present). Validates response shape and dimension; raises
    ``EmbeddingProviderError`` on any failure so the caller can decide
    whether to fall back / retry.

    The API key is never logged. ``HTTP-Referer`` and ``X-Title`` are
    optional attribution headers requested by OpenRouter; they are sent
    only when configured.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        dimension: int,
        base_url: str = "https://openrouter.ai/api/v1",
        site_url: str | None = None,
        app_name: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        if not api_key:
            raise EmbeddingProviderError(
                "OpenRouterEmbeddingService requires OPENROUTER_API_KEY."
            )
        self._api_key = api_key
        self._model = model
        self._dim = dimension
        self._base_url = base_url.rstrip("/")
        self._site_url = site_url
        self._app_name = app_name
        self._timeout_s = timeout_s

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._site_url:
            headers["HTTP-Referer"] = self._site_url
        if self._app_name:
            # OpenRouter accepts X-Title (the spec'd header). The user's
            # request also mentioned X-OpenRouter-Title; we send X-Title
            # which is what the public docs document.
            headers["X-Title"] = self._app_name
        return headers

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # OpenAI-family token limit ~8191 → cap chars conservatively.
        safe_texts = [t[:32000] for t in texts]
        payload: dict[str, Any] = {
            "model": self._model,
            "input": safe_texts,
            "dimensions": self._dim,
        }

        import httpx  # deferred import; httpx is already in requirements.

        url = f"{self._base_url}/embeddings"
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                resp = await client.post(url, json=payload, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise EmbeddingProviderError(
                f"OpenRouter embeddings request timed out after {self._timeout_s}s"
            ) from exc
        except httpx.HTTPError as exc:
            raise EmbeddingProviderError(
                f"OpenRouter embeddings transport error: {exc}"
            ) from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            # Avoid leaking auth header; resp.text may include error detail.
            raise EmbeddingProviderError(
                f"OpenRouter embeddings HTTP {resp.status_code}: "
                f"{resp.text[:500]}"
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise EmbeddingProviderError(
                "OpenRouter embeddings: response was not valid JSON"
            ) from exc

        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise EmbeddingProviderError(
                "OpenRouter embeddings: missing 'data' array in response"
            )
        if len(items) != len(safe_texts):
            raise EmbeddingProviderError(
                f"OpenRouter embeddings: expected {len(safe_texts)} vectors, "
                f"got {len(items)}"
            )

        # Sort by index when provided, else trust order.
        def _idx(item: Any, fallback: int) -> int:
            if isinstance(item, dict) and isinstance(item.get("index"), int):
                return item["index"]
            return fallback

        ordered = sorted(
            ((item, i) for i, item in enumerate(items)),
            key=lambda pair: _idx(pair[0], pair[1]),
        )

        result: list[list[float]] = []
        for item, _ in ordered:
            if not isinstance(item, dict):
                raise EmbeddingProviderError(
                    "OpenRouter embeddings: malformed entry in 'data'"
                )
            vec = item.get("embedding")
            if not isinstance(vec, list) or not vec:
                raise EmbeddingProviderError(
                    "OpenRouter embeddings: missing or empty 'embedding'"
                )
            # Strict validation: length, numeric, no NaN/Inf.
            result.append(
                _validate_embedding_vector(
                    vec, self._dim, context="OpenRouter embeddings"
                )
            )
        return result


class GeminiEmbeddingService(EmbeddingService):
    """
    Google Gemini embeddings via the Generative Language REST API.

    Uses GEMINI_API_KEY and calls:
        POST https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents
    """

    _DEFAULT_MODEL = "text-embedding-004"

    def __init__(self, api_key: str, model: str = _DEFAULT_MODEL) -> None:
        if not api_key:
            raise EmbeddingProviderError("GeminiEmbeddingService requires GEMINI_API_KEY.")
        self._api_key = api_key
        self._model = model

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import httpx  # deferred; httpx is in requirements

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._model}:batchEmbedContents?key={self._api_key}"
        )
        payload = {
            "requests": [
                {"model": f"models/{self._model}", "content": {"parts": [{"text": t[:32000]}]}}
                for t in texts
            ]
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise EmbeddingProviderError(f"Gemini embeddings transport error: {exc}") from exc

        if resp.status_code < 200 or resp.status_code >= 300:
            raise EmbeddingProviderError(
                f"Gemini embeddings HTTP {resp.status_code}: {resp.text[:500]}"
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise EmbeddingProviderError("Gemini embeddings: response was not valid JSON") from exc

        embeddings = data.get("embeddings")
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise EmbeddingProviderError(
                f"Gemini embeddings: expected {len(texts)} vectors, got unexpected response shape"
            )

        result: list[list[float]] = []
        for item in embeddings:
            vec = item.get("values") if isinstance(item, dict) else None
            if not isinstance(vec, list) or not vec:
                raise EmbeddingProviderError("Gemini embeddings: missing 'values' in response item")
            result.append([float(v) for v in vec])
        return result


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

    Selection is driven by ``settings.EMBEDDING_PROVIDER``:
      • openrouter → OpenRouterEmbeddingService (needs OPENROUTER_API_KEY)
      • openai     → OpenAIEmbeddingService (needs OPENAI_API_KEY)
      • gemini     → GeminiEmbeddingService (needs GEMINI_API_KEY)
      • mock       → MockEmbeddingService (zero vectors, for tests/offline dev)

    Misconfiguration policy:
      • Empty provider → raise (mock fallback only in test mode or when
        EMBEDDING_ALLOW_MOCK_FALLBACK=True).
      • Provider selected but API key missing → raise.
      • Provider=mock is always honored (explicit opt-in).

    Use ``set_embedding_service(instance)`` in tests to inject a fake.
    """
    global _instance
    if _instance is None:
        _instance = _make_service()
    return _instance


def set_embedding_service(instance: EmbeddingService) -> None:
    """Override the singleton — used in tests to inject MockEmbeddingService."""
    global _instance
    _instance = instance


def reset_embedding_service_for_tests() -> None:
    """Reset the singleton — used in test teardown to restore default."""
    global _instance
    _instance = None


def _allow_mock_fallback(settings: Any) -> bool:
    """Mock fallback is allowed in test mode or when explicitly enabled."""
    if _is_test_environment():
        return True
    return bool(getattr(settings, "EMBEDDING_ALLOW_MOCK_FALLBACK", False))


def _make_service() -> EmbeddingService:
    from app.core.config import settings  # deferred — avoids circular import

    raw_provider = (settings.EMBEDDING_PROVIDER or "").strip()
    provider = raw_provider.lower()
    dim = int(settings.EMBEDDING_DIM)
    model = settings.EMBEDDING_MODEL or ""

    if not provider:
        msg = (
            "EMBEDDING_PROVIDER is empty. RAG cannot work without a real "
            "embedding provider. Set EMBEDDING_PROVIDER=openrouter (recommended) "
            "with OPENROUTER_API_KEY in your .env, or set EMBEDDING_PROVIDER=mock "
            "explicitly if you want zero-vector embeddings for offline dev."
        )
        if _allow_mock_fallback(settings):
            logger.warning("%s — falling back to MockEmbeddingService (test/dev mode).", msg)
            return MockEmbeddingService()
        raise EmbeddingProviderError(msg)

    if provider == "mock":
        logger.warning(
            "Embedding provider: MOCK (zero-vector, dim=%d). RAG retrieval "
            "will return arbitrary results — set EMBEDDING_PROVIDER=openrouter "
            "for real semantic search.",
            dim,
        )
        return MockEmbeddingService()

    if provider == "openrouter":
        if not settings.OPENROUTER_API_KEY:
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER=openrouter but OPENROUTER_API_KEY is not set. "
                "Add OPENROUTER_API_KEY=sk-or-... to your .env (key is never logged)."
            )
        base_url = (settings.EMBEDDING_BASE_URL or settings.OPENROUTER_BASE_URL).rstrip("/")
        logger.info(
            "Embedding provider: OpenRouter (model=%s, dim=%d, base_url=%s)",
            model, dim, base_url,
        )
        return OpenRouterEmbeddingService(
            api_key=settings.OPENROUTER_API_KEY,
            model=model,
            dimension=dim,
            base_url=base_url,
            site_url=settings.OPENROUTER_SITE_URL,
            app_name=settings.OPENROUTER_APP_NAME,
        )

    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set."
            )
        logger.info("Embedding provider: OpenAI (model=%s, dim=%d)", model, dim)
        return OpenAIEmbeddingService(api_key=settings.OPENAI_API_KEY, model=model)

    if provider == "gemini":
        if not getattr(settings, "GEMINI_API_KEY", None):
            raise EmbeddingProviderError(
                "EMBEDDING_PROVIDER=gemini but GEMINI_API_KEY is not set."
            )
        gem_model = model
        if "/" in gem_model:  # strip openrouter-style prefix if pasted by mistake
            gem_model = gem_model.split("/", 1)[1]
        if not gem_model:
            gem_model = GeminiEmbeddingService._DEFAULT_MODEL
        logger.info("Embedding provider: Gemini (model=%s, dim=%d)", gem_model, dim)
        return GeminiEmbeddingService(api_key=settings.GEMINI_API_KEY, model=gem_model)

    # Unknown provider value.
    msg = (
        f"Unknown EMBEDDING_PROVIDER={raw_provider!r}. "
        "Valid values: openrouter, openai, gemini, mock."
    )
    if _allow_mock_fallback(settings):
        logger.warning("%s — falling back to MockEmbeddingService (test/dev mode).", msg)
        return MockEmbeddingService()
    raise EmbeddingProviderError(msg)
