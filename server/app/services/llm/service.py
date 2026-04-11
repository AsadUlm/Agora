"""Abstract LLM service interface and factory."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas.contracts import LLMRequest, LLMResponse


class LLMService(ABC):
    """
    Abstract interface for LLM providers.

    All concrete providers (Groq, OpenAI, Mock) implement this.
    One method: generate(LLMRequest) → LLMResponse.

    JSON parsing is the caller's responsibility (RoundManager._call_llm
    uses llm.parser.parse_json_from_llm on the raw content).
    """

    @abstractmethod
    async def generate(self, request: LLMRequest) -> LLMResponse:
        """Generate a completion from the LLM."""


def get_llm_service() -> LLMService:
    """
    Factory: return the configured LLM service instance.

    The actual implementation is registered in Step 2 (llm/providers/).
    Import is deferred to avoid circular imports and allow test overrides.
    """
    from app.services.llm._factory import _get_service_instance  # noqa: PLC0415
    return _get_service_instance()
