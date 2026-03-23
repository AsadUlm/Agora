"""
Groq LLM provider.

Uses the official `groq` Python SDK (AsyncGroq) so calls are fully async
and never block the event loop.

Supported models (as of early 2026):
  • llama-3.3-70b-versatile   ← default, supports json_object response format
  • llama3-70b-8192
  • mixtral-8x7b-32768

Selection: set LLM_PROVIDER=groq and GROQ_API_KEY in .env.
Model: controlled via LLM_MODEL in .env.
"""

import logging

from groq import AsyncGroq

from app.services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a precise AI assistant that always responds with valid JSON only. "
    "Never include markdown formatting, code fences, or any text outside the JSON object. "
    "Your entire response must be a single, parseable JSON object."
)


class GroqProvider(LLMProvider):
    """
    Async Groq provider.

    All Groq-specific SDK details are isolated here.
    The rest of the application never imports from `groq` directly.
    """

    def __init__(self, api_key: str, model: str, temperature: float) -> None:
        self._client = AsyncGroq(api_key=api_key)
        self._model = model
        self._temperature = temperature

    async def generate(self, prompt: str) -> str:
        """
        Send a prompt to Groq and return the raw JSON string.

        Uses response_format=json_object to enforce structured output.
        A system prompt reinforces the JSON-only constraint as a second layer.
        """
        logger.debug("GroqProvider: calling model=%s", self._model)
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=self._temperature,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        logger.debug("GroqProvider: received %d chars.", len(content or ""))
        return content or ""

    @property
    def provider_name(self) -> str:
        return "groq"
