"""
Google Gemini LLM Provider.

Uses Google's OpenAI-compatible endpoint (AI Studio).
Get a free API key at https://aistudio.google.com/apikey

Free models:
  - gemini-2.0-flash
  - gemini-1.5-flash
  - gemini-1.5-pro
"""

from __future__ import annotations

import logging
import time

from openai import AsyncOpenAI, APIStatusError, APITimeoutError

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.llm.exceptions import LLMGenerationError
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class GeminiProvider(LLMService):
    def __init__(self, api_key: str, default_model: str, default_temperature: float) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=GEMINI_BASE_URL)
        self._default_model = default_model
        self._default_temperature = default_temperature

    async def generate(self, request: LLMRequest) -> LLMResponse:
        model = request.model or self._default_model
        temperature = (
            request.temperature if request.temperature is not None else self._default_temperature
        )

        logger.debug("GeminiProvider.generate: model=%s", model)

        t_start = time.monotonic()
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": request.prompt}],
                temperature=temperature,
                max_tokens=request.max_tokens,
            )
        except APITimeoutError as exc:
            raise LLMGenerationError(f"Gemini API timeout: {exc}") from exc
        except APIStatusError as exc:
            raise LLMGenerationError(f"Gemini API error {exc.status_code}: {exc.message}") from exc
        except Exception as exc:
            raise LLMGenerationError(f"Gemini unexpected error: {exc}") from exc

        latency_ms = int((time.monotonic() - t_start) * 1000)
        content = response.choices[0].message.content or ""
        usage = response.usage

        return LLMResponse(
            content=content,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )
