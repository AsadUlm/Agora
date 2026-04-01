"""
LLM Provider factory.

Centralises provider selection so no if/else chains exist outside this file.
New providers are registered here and nowhere else.

Provider selection is driven entirely by settings.LLM_PROVIDER.

Supported values:
  "groq"   — Groq (AsyncGroq SDK)
  "openai" — OpenAI (AsyncOpenAI SDK)
  "mock"   — Deterministic mock (no API calls)

Any other value is checked against the provider registry.  If it maps
to a *placeholder* provider, a ``ProviderUnavailableError`` is raised
with a clear user-facing message.
"""

import logging

from app.core.config import settings
from app.services.llm.base import LLMProvider
from app.services.llm.exceptions import ProviderConfigError, ProviderUnavailableError

logger = logging.getLogger(__name__)


def create_provider() -> LLMProvider:
    """
    Instantiate and return the configured LLM provider.

    Reads LLM_PROVIDER from settings and returns the matching implementation.
    For placeholder providers raises ProviderUnavailableError.
    For completely unknown names raises ProviderConfigError.
    """
    provider_name = settings.LLM_PROVIDER.lower()

    if provider_name == "groq":
        return _build_groq()

    if provider_name == "openai":
        return _build_openai()

    if provider_name == "mock":
        return _build_mock()

    # Check registry for placeholders before giving a generic error
    from app.services.llm.registry import get_registry

    registry = get_registry()
    info = registry.get_provider(provider_name)
    if info and info.status == "placeholder":
        raise ProviderUnavailableError(provider_name)

    raise ProviderConfigError(
        f"Unknown LLM_PROVIDER={settings.LLM_PROVIDER!r}. "
        "Valid options: 'groq', 'openai', 'mock'."
    )


# ── Private builder functions ────────────────────────────────────────────────
# Each builder validates its required settings and returns a provider instance.

def _build_groq() -> LLMProvider:
    from app.services.llm.providers.groq_provider import GroqProvider

    if not settings.GROQ_API_KEY:
        raise ProviderConfigError(
            "LLM_PROVIDER=groq requires GROQ_API_KEY to be set in .env."
        )
    logger.info("LLM provider: Groq | model=%s", settings.LLM_MODEL)
    return GroqProvider(
        api_key=settings.GROQ_API_KEY,
        model=settings.LLM_MODEL,
        temperature=settings.LLM_TEMPERATURE,
    )


def _build_openai() -> LLMProvider:
    from app.services.llm.providers.openai_provider import OpenAIProvider

    if not settings.OPENAI_API_KEY:
        raise ProviderConfigError(
            "LLM_PROVIDER=openai requires OPENAI_API_KEY to be set in .env."
        )
    logger.info("LLM provider: OpenAI | model=%s", settings.LLM_MODEL)
    return OpenAIProvider(
        api_key=settings.OPENAI_API_KEY,
        model=settings.LLM_MODEL,
        temperature=settings.LLM_TEMPERATURE,
    )


def _build_mock() -> LLMProvider:
    from app.services.llm.providers.mock_provider import MockProvider

    logger.info("LLM provider: Mock (no API calls will be made).")
    return MockProvider()
