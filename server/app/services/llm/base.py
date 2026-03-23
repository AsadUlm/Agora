"""
LLM Provider abstract base class.

All concrete providers (Groq, OpenAI, Mock, …) must implement this interface.
The rest of the application depends ONLY on this contract — never on a
specific provider's SDK.
"""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Single-method interface every provider must satisfy."""

    @abstractmethod
    async def generate(self, prompt: str) -> str:
        """
        Send a prompt and return the raw response string.

        The returned string MUST be valid JSON (or parseable as JSON after
        light cleanup).  Providers are responsible for enforcing this via
        response_format, system messages, or fallback logic.

        Args:
            prompt: The fully-rendered user prompt.

        Returns:
            Raw LLM output string (expected to be a JSON object).
        """
        ...

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Human-readable identifier for logging / metadata."""
        ...
