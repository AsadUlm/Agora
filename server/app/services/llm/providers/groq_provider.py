"""
Groq LLM Provider.

Uses the official `groq` Python SDK (AsyncGroq) to call the Groq API.
Requires GROQ_API_KEY in environment / .env file.

Supported models (as of 2026):
  - llama-3.3-70b-versatile  (default, recommended)
  - llama-3.1-70b-versatile
  - mixtral-8x7b-32768
  - gemma2-9b-it
"""

from __future__ import annotations

import logging
import time

from groq import AsyncGroq, APIStatusError, APITimeoutError

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.llm.exceptions import LLMGenerationError
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)

# Hard safety ceiling. Mirrors `MAX_ALLOWED_TOKENS` in the round manager.
MAX_ALLOWED_TOKENS = 2000
DEFAULT_MAX_TOKENS = 1000


class GroqProvider(LLMService):
    """
    LLM service backed by Groq's inference API.

    Thread-safe: AsyncGroq client is reused across calls.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str,
        default_temperature: float,
    ) -> None:
        self._client = AsyncGroq(api_key=api_key)
        self._default_model = default_model
        self._default_temperature = default_temperature

    async def generate(self, request: LLMRequest) -> LLMResponse:
        """
        Call Groq API and return a raw LLMResponse.

        Raises:
            LLMGenerationError: On API error or timeout.
        """
        model = request.model or self._default_model
        temperature = request.temperature if request.temperature is not None else self._default_temperature

        requested_max = request.max_tokens if request.max_tokens is not None else DEFAULT_MAX_TOKENS
        max_tokens = min(requested_max, MAX_ALLOWED_TOKENS)
        if request.max_tokens is not None and request.max_tokens > MAX_ALLOWED_TOKENS:
            logger.warning(
                "GroqProvider: requested max_tokens=%d exceeds ceiling, clamped to %d",
                request.max_tokens,
                MAX_ALLOWED_TOKENS,
            )

        logger.debug(
            "GroqProvider.generate: model=%s temperature=%.2f max_tokens=%d prompt_len=%d",
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
            raise LLMGenerationError(f"Groq API timeout: {exc}") from exc
        except APIStatusError as exc:
            raise LLMGenerationError(
                f"Groq API error {exc.status_code}: {exc.message}"
            ) from exc
        except Exception as exc:
            raise LLMGenerationError(f"Groq unexpected error: {exc}") from exc

        latency_ms = int((time.monotonic() - t_start) * 1000)
        content = response.choices[0].message.content or ""
        usage = response.usage

        logger.debug(
            "GroqProvider.generate: done latency=%dms tokens_in=%d tokens_out=%d",
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
