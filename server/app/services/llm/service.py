"""
LLMService — unified entry point for all LLM interactions.

This is the ONLY LLM-related symbol that the rest of the application
(DebateEngine, round logic, etc.) should import and use.

Usage:
    from app.services.llm.service import get_llm_service

    service = get_llm_service()
    result: dict = await service.generate_structured(prompt)

Design:
  • LLMService holds a provider reference (set at startup via the factory).
  • It calls the provider, parses the response with the shared parser,
    and returns a clean dict — callers never touch raw strings or JSON parsing.
  • On provider failures it raises LLMGenerationError; on parse failures it
    raises LLMParsingError.  Callers decide how to handle them.
  • The singleton is initialised once at first use (lazy) and re-used for the
    entire application lifetime.  Thread-safety is not a concern in an async
    single-process FastAPI app.
"""

import logging

from app.services.llm.base import LLMProvider
from app.services.llm.exceptions import LLMGenerationError, LLMParsingError
from app.services.llm.schemas import LLMResponse
from app.services.llm.utils.parser import extract_json

logger = logging.getLogger(__name__)

# Module-level singleton — created once, reused everywhere.
_service: "LLMService | None" = None


class LLMService:
    """
    Provider-agnostic LLM service.

    Responsibilities:
      1. Delegate the raw generate call to the injected provider.
      2. Parse/validate the returned string via the shared JSON parser.
      3. Return structured output (dict) to the caller.
      4. Raise typed exceptions on failure so callers can react explicitly.
    """

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider

    async def generate_structured(self, prompt: str) -> dict:
        """
        Send a prompt and return a parsed dict.

        Raises:
            LLMGenerationError: The provider failed (network, auth, rate-limit).
            LLMParsingError:    A response was received but JSON parsing failed.
        """
        try:
            raw = await self._provider.generate(prompt)
        except Exception as exc:
            raise LLMGenerationError(
                provider=self._provider.provider_name,
                detail=str(exc),
            ) from exc

        parsed, error = extract_json(raw)

        if error:
            raise LLMParsingError(
                provider=self._provider.provider_name,
                raw=raw,
                detail=error,
            )

        return parsed

    async def generate_raw(self, prompt: str) -> LLMResponse:
        """
        Send a prompt and return a full LLMResponse (raw + parsed + metadata).

        Use this when the caller needs access to raw output or provider name.

        Raises:
            LLMGenerationError: The provider failed.
        """
        try:
            raw = await self._provider.generate(prompt)
        except Exception as exc:
            raise LLMGenerationError(
                provider=self._provider.provider_name,
                detail=str(exc),
            ) from exc

        parsed, error = extract_json(raw)

        return LLMResponse(
            raw=raw,
            parsed=parsed,
            provider=self._provider.provider_name,
            parse_error=error,
        )

    @property
    def provider_name(self) -> str:
        return self._provider.provider_name


def get_llm_service() -> "LLMService":
    """
    Return the application-wide LLMService singleton.

    Creates it on first call using the provider factory.
    Subsequent calls return the cached instance.
    """
    global _service
    if _service is None:
        from app.services.llm.factory import create_provider
        provider = create_provider()
        _service = LLMService(provider=provider)
        logger.info("LLMService initialised with provider: %s", provider.provider_name)
    return _service
