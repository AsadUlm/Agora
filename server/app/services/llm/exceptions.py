"""LLM service exception hierarchy — internal contract."""

from __future__ import annotations


class LLMError(Exception):
    """Base class for all LLM-related errors."""


class ProviderConfigError(LLMError):
    """Raised when an LLM provider is misconfigured (missing API key, etc.)."""


class ProviderUnavailableError(LLMError):
    """Raised when the selected provider is a placeholder and cannot be used."""


class LLMGenerationError(LLMError):
    """Raised when the LLM call itself fails (API error, timeout, etc.)."""


class LLMParseError(LLMError):
    """Raised when the LLM response cannot be parsed into expected structure."""
