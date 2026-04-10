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
from app.services.llm.exceptions import LLMGenerationError, LLMParseError
from app.services.llm.parser import parse_json_from_llm
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)


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

        logger.debug(
            "GroqProvider.generate: model=%s temperature=%.2f prompt_len=%d",
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

    async def generate_structured(self, prompt: str) -> dict:
        """
        Call Groq and parse the response as JSON.

        Raises:
            LLMGenerationError: On API failure.
            LLMParseError:      If the response cannot be parsed as JSON.
        """
        request = LLMRequest(
            provider="groq",
            model=self._default_model,
            prompt=prompt,
            temperature=self._default_temperature,
        )
        response = await self.generate(request)
        return parse_json_from_llm(response.content)
