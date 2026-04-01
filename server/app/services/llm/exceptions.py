"""
Custom exception hierarchy for the LLM service layer.

These exceptions provide explicit, typed error signals to callers
instead of silent empty-dict fallbacks.

Hierarchy:
    LLMError
    ├── LLMGenerationError     — provider call failed (network, auth, rate-limit)
    ├── LLMParsingError        — response received but JSON parsing failed
    ├── ProviderConfigError    — provider misconfigured (missing key, unknown name)
    └── ProviderUnavailableError — placeholder provider requested
"""


class LLMError(Exception):
    """Base for all LLM-layer exceptions."""


class LLMGenerationError(LLMError):
    """The underlying LLM provider failed to produce a response."""

    def __init__(self, provider: str, detail: str) -> None:
        self.provider = provider
        self.detail = detail
        super().__init__(f"[{provider}] generation failed: {detail}")


class LLMParsingError(LLMError):
    """We received a response but could not parse it as valid JSON."""

    def __init__(self, provider: str, raw: str, detail: str) -> None:
        self.provider = provider
        self.raw = raw
        self.detail = detail
        super().__init__(f"[{provider}] JSON parse failed: {detail}")


class ProviderConfigError(LLMError):
    """The LLM provider is incorrectly configured (missing key, bad name, etc.)."""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(f"Provider configuration error: {detail}")


class ProviderUnavailableError(LLMError):
    """A placeholder provider was requested but is not yet implemented."""

    def __init__(self, provider: str) -> None:
        self.provider = provider
        super().__init__(
            f"Provider '{provider}' is registered as a placeholder and "
            f"is not yet available for use. Please choose an active provider."
        )
