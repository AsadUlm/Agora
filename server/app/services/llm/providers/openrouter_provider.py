"""
OpenRouter LLM Provider.

Uses the OpenAI-compatible API at https://openrouter.ai/api/v1.
The exposed catalog is curated in app.services.llm.registry.
"""

from __future__ import annotations

import logging
import time

from openai import AsyncOpenAI, APIStatusError, APITimeoutError

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.llm.exceptions import LLMGenerationError
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Hard safety ceiling. Mirrors `MAX_ALLOWED_TOKENS` in the round manager so
# even ad-hoc callers cannot blow the OpenRouter credit budget.
MAX_ALLOWED_TOKENS = 1200
DEFAULT_MAX_TOKENS = 850


class OpenRouterProvider(LLMService):
    """
    LLM service backed by OpenRouter's OpenAI-compatible API.

    Thread-safe: AsyncOpenAI client is reused across calls.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str,
        default_temperature: float,
    ) -> None:
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=OPENROUTER_BASE_URL,
        )
        self._default_model = default_model
        self._default_temperature = default_temperature

    async def generate(self, request: LLMRequest) -> LLMResponse:
        model = request.model or self._default_model
        temperature = (
            request.temperature
            if request.temperature is not None
            else self._default_temperature
        )

        # Clamp max_tokens to the hard safety ceiling. None → DEFAULT_MAX_TOKENS
        # so the OpenAI client never sends a null value (which OpenRouter
        # interprets as the model's full completion window and reserves
        # credits accordingly, causing 402 errors).
        requested_max = request.max_tokens if request.max_tokens is not None else DEFAULT_MAX_TOKENS
        max_tokens = min(requested_max, MAX_ALLOWED_TOKENS)
        if request.max_tokens is not None and request.max_tokens > MAX_ALLOWED_TOKENS:
            logger.warning(
                "OpenRouterProvider: requested max_tokens=%d exceeds ceiling, clamped to %d",
                request.max_tokens,
                MAX_ALLOWED_TOKENS,
            )

        logger.debug(
            "OpenRouterProvider.generate: model=%s temperature=%.2f max_tokens=%d prompt_len=%d",
            model,
            temperature,
            max_tokens,
            len(request.prompt),
        )

        t_start = time.monotonic()
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except APITimeoutError as exc:
            raise LLMGenerationError(f"OpenRouter API timeout: {exc}") from exc
        except APIStatusError as exc:
            raise LLMGenerationError(
                f"OpenRouter API error {exc.status_code}: {exc.message}"
            ) from exc
        except Exception as exc:
            raise LLMGenerationError(
                f"OpenRouter unexpected error: {exc}"
            ) from exc

        latency_ms = int((time.monotonic() - t_start) * 1000)
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice is not None else None
        # Robust content extraction: reasoning models on OpenRouter sometimes
        # return the answer in `reasoning` / `text` fields rather
        # than `content`. Fall back through known alternatives before declaring
        # the response empty.
        content = ""
        if message is not None:
            for attr in ("content", "reasoning", "text", "output_text"):
                value = getattr(message, attr, None)
                if isinstance(value, str) and value.strip():
                    content = value
                    break
        usage = response.usage

        logger.debug(
            "OpenRouterProvider.generate: done latency=%dms tokens_in=%d tokens_out=%d",
            latency_ms,
            usage.prompt_tokens if usage else 0,
            usage.completion_tokens if usage else 0,
        )

        return LLMResponse(
            content=content,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )
