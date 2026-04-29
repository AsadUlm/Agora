"""
Multi-provider router — dispatches LLM requests to the correct provider.

Each agent can specify its own provider/model via AgentContext.
The router holds a dict of initialized providers and routes accordingly,
falling back to the default provider when the requested one isn't configured.
"""

from __future__ import annotations

import logging

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.llm.exceptions import LLMGenerationError
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)


class ProviderRouter(LLMService):
    """
    Routes LLMRequest to the concrete provider based on request.provider.

    Falls back to the default provider if the requested provider
    is not registered.
    """

    def __init__(
        self,
        providers: dict[str, LLMService],
        default_provider: str,
    ) -> None:
        self._providers = providers
        self._default = default_provider

    @property
    def available_providers(self) -> list[str]:
        return list(self._providers.keys())

    async def generate(self, request: LLMRequest) -> LLMResponse:
        provider_key = request.provider.lower() if request.provider else self._default

        service = self._providers.get(provider_key)
        if service is None:
            # Fall back to default
            logger.warning(
                "Provider '%s' not configured, falling back to '%s'",
                provider_key,
                self._default,
            )
            service = self._providers.get(self._default)

        if service is None:
            raise LLMGenerationError(
                f"No LLM provider available (requested='{provider_key}', "
                f"default='{self._default}', configured={list(self._providers.keys())})"
            )

        return await service.generate(request)
