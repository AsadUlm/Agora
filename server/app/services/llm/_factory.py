"""
LLM service factory — returns the active LLMService implementation.

Selection logic (in order):
  1. If LLM_PROVIDER=mock → MockProvider (always available, used in tests)
  2. If LLM_PROVIDER=groq and GROQ_API_KEY is set → GroqProvider
  3. If LLM_PROVIDER=openai and OPENAI_API_KEY is set → OpenAIProvider (Step 2+)
  4. Fallback → MockProvider with a warning (server starts cleanly without keys)
"""

from __future__ import annotations

import logging

from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)

_instance: LLMService | None = None


def _get_service_instance() -> LLMService:
    global _instance
    if _instance is None:
        _instance = _make_service()
    return _instance


def _make_service() -> LLMService:
    from app.core.config import settings  # deferred to avoid circular import

    provider = settings.LLM_PROVIDER.lower()

    if provider == "mock":
        from app.services.llm.providers.mock_provider import MockProvider
        logger.info("LLM provider: Mock (testing mode)")
        return MockProvider()

    if provider == "groq":
        if settings.GROQ_API_KEY:
            from app.services.llm.providers.groq_provider import GroqProvider
            logger.info(
                "LLM provider: Groq (model=%s, temperature=%.2f)",
                settings.LLM_MODEL,
                settings.LLM_TEMPERATURE,
            )
            return GroqProvider(
                api_key=settings.GROQ_API_KEY,
                default_model=settings.LLM_MODEL,
                default_temperature=settings.LLM_TEMPERATURE,
            )
        else:
            logger.warning(
                "LLM_PROVIDER=groq but GROQ_API_KEY is not set. "
                "Falling back to MockProvider. Set GROQ_API_KEY in .env to use real LLM."
            )

    if provider == "openai":
        if settings.OPENAI_API_KEY:
            # Step 2+: OpenAI provider (same interface as Groq)
            logger.warning("OpenAI provider not yet implemented. Falling back to Mock.")
        else:
            logger.warning(
                "LLM_PROVIDER=openai but OPENAI_API_KEY is not set. Falling back to Mock."
            )

    from app.services.llm.providers.mock_provider import MockProvider
    logger.info("LLM provider: Mock (fallback)")
    return MockProvider()


def set_service(instance: LLMService) -> None:
    """Override the singleton — used in tests to inject MockProvider."""
    global _instance
    _instance = instance


def reset_service() -> None:
    """Reset the singleton — used in tests to restore default."""
    global _instance
    _instance = None

