"""
OpenRouter LLM Provider.

Uses the OpenAI-compatible API at https://openrouter.ai/api/v1.
Supports both free and paid models. Requires OPENROUTER_API_KEY.

Free models (as of 2026):
  - meta-llama/llama-3.3-70b-instruct:free
  - qwen/qwen-2.5-72b-instruct:free
  - google/gemma-2-9b-it:free
  - mistralai/mistral-7b-instruct:free
  - deepseek/deepseek-r1-0528:free
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

        logger.debug(
            "OpenRouterProvider.generate: model=%s temperature=%.2f prompt_len=%d",
            model,
            temperature,
            len(request.prompt),
        )

        t_start = time.monotonic()
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=temperature,
                max_tokens=request.max_tokens,
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
        content = response.choices[0].message.content or ""
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
