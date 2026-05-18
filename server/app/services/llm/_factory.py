"""
LLM service factory — returns the active LLMService implementation.

Builds a ProviderRouter that holds all configured providers so each agent
can use a different provider/model.  The default provider is LLM_PROVIDER.

Selection logic for each provider:
  - groq:       GROQ_API_KEY must be set
  - openrouter: OPENROUTER_API_KEY must be set
  - mock:       always available

If no real providers are configured the router falls back to MockProvider.
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
    from app.services.llm.providers.router import ProviderRouter

    providers: dict[str, LLMService] = {}
    default_provider = settings.LLM_PROVIDER.lower()

    # ── Mock (always available) ──────────────────────────────────────
    providers["mock"] = MockProvider()

    # ── Groq ─────────────────────────────────────────────────────────
    if settings.GROQ_API_KEY:
        from app.services.llm.providers.groq_provider import GroqProvider

        providers["groq"] = GroqProvider(
            api_key=settings.GROQ_API_KEY,
            default_model=settings.LLM_MODEL,
            default_temperature=settings.LLM_TEMPERATURE,
        )
        logger.info(
            "LLM provider registered: Groq (model=%s)",
            settings.LLM_MODEL,
        )
    else:
        logger.warning("GROQ_API_KEY not set — Groq provider disabled.")

    # ── OpenRouter ───────────────────────────────────────────────────
    if settings.OPENROUTER_API_KEY:
        from app.services.llm.providers.openrouter_provider import OpenRouterProvider

        providers["openrouter"] = OpenRouterProvider(
            api_key=settings.OPENROUTER_API_KEY,
            default_model=settings.OPENROUTER_MODEL,
            default_temperature=settings.LLM_TEMPERATURE,
        )
        logger.info(
            "LLM provider registered: OpenRouter (model=%s)",
            settings.OPENROUTER_MODEL,
        )
    else:
        logger.info("OPENROUTER_API_KEY not set — OpenRouter provider disabled.")

    # ── Validate default provider is available ───────────────────────
    if default_provider not in providers:
        logger.warning(
            "Default LLM_PROVIDER='%s' is not configured. "
            "Falling back to '%s'.",
            default_provider,
            "mock" if len(providers) == 1 else next(
                (k for k in providers if k != "mock"), "mock"
            ),
        )
        # Pick first real provider, or mock
        default_provider = next(
            (k for k in providers if k != "mock"), "mock"
        )

    real_providers = [k for k in providers if k != "mock"]
    logger.info(
        "LLM router ready: default='%s', available=%s",
        default_provider,
        real_providers or ["mock"],
    )

    return ProviderRouter(providers=providers, default_provider=default_provider)


def set_service(instance: LLMService) -> None:
    """Override the singleton — used in tests to inject MockProvider."""
    global _instance
    _instance = instance


def reset_service() -> None:
    """Reset the singleton — used in tests to restore default."""
    global _instance
    _instance = None

