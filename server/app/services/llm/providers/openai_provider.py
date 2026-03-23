"""
OpenAI LLM provider.

Uses the official `openai` Python SDK (AsyncOpenAI).

Selection: set LLM_PROVIDER=openai and OPENAI_API_KEY in .env.
Model: controlled via LLM_MODEL in .env (e.g. gpt-4o, gpt-4-turbo).
"""

import logging

from openai import AsyncOpenAI

from app.services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a precise AI assistant that always responds with valid JSON only. "
    "Never include markdown formatting, code fences, or any text outside the JSON object. "
    "Your entire response must be a single, parseable JSON object."
)


class OpenAIProvider(LLMProvider):
    """
    Async OpenAI provider.

    All OpenAI-specific SDK details are isolated here.
    """

    def __init__(self, api_key: str, model: str, temperature: float) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._temperature = temperature

    async def generate(self, prompt: str) -> str:
        """
        Send a prompt to OpenAI and return the raw JSON string.

        Uses response_format=json_object to enforce structured output.
        """
        logger.debug("OpenAIProvider: calling model=%s", self._model)
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
        logger.debug("OpenAIProvider: received %d chars.", len(content or ""))
        return content or ""

    @property
    def provider_name(self) -> str:
        return "openai"
