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
    from app.services.llm.providers.mock_provider import MockProvider

    provider = settings.LLM_PROVIDER.lower()

    if provider == "mock":
        logger.info("LLM provider: Mock (testing mode)")
        return MockProvider()

    # Build a multi-provider router so agents can specify their own provider
    providers: dict[str, LLMService] = {}

    if settings.GROQ_API_KEY:
        from app.services.llm.providers.groq_provider import GroqProvider
        providers["groq"] = GroqProvider(
            api_key=settings.GROQ_API_KEY,
            default_model=settings.LLM_MODEL,
            default_temperature=settings.LLM_TEMPERATURE,
        )
        logger.info("Registered provider: groq")

    if getattr(settings, "OPENROUTER_API_KEY", None):
        from app.services.llm.providers.openrouter_provider import OpenRouterProvider
        providers["openrouter"] = OpenRouterProvider(
            api_key=settings.OPENROUTER_API_KEY,
            default_model=getattr(settings, "OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
            default_temperature=settings.LLM_TEMPERATURE,
        )
        logger.info("Registered provider: openrouter")

    if not providers:
        logger.warning("No API keys configured. Falling back to MockProvider.")
        return MockProvider()

    # Use router so per-agent provider field is respected
    from app.services.llm.providers.router import ProviderRouter
    default = provider if provider in providers else next(iter(providers))
    logger.info("LLM router active (default=%s, available=%s)", default, list(providers.keys()))
    return ProviderRouter(providers=providers, default_provider=default)


def set_service(instance: LLMService) -> None:
    """Override the singleton — used in tests to inject MockProvider."""
    global _instance
    _instance = instance


def reset_service() -> None:
    """Reset the singleton — used in tests to restore default."""
    global _instance
    _instance = None

