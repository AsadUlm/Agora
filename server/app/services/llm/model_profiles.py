"""Model stability profiles (Phase 7).

Classifies catalog models by how reliably they produce well-formed structured
(JSON) output. Used to (a) keep experimental models out of default presets and
(b) let the API / UI warn when an experimental model is selected.

These are operational reliability tiers, not quality rankings — a model can be
excellent at prose yet unreliable at strict JSON.
"""

from __future__ import annotations

# Models that reliably emit well-formed JSON for the debate schemas.
STABLE_STRUCTURED_MODELS: frozenset[str] = frozenset(
    {
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-3-haiku",
        "openai/gpt-4.1-mini",
        "openai/gpt-4.1-nano",
        "openai/gpt-4o-mini",
        "openai/gpt-5.5",
        "google/gemini-3.1-pro",
        "google/gemini-2.0-flash-001",
        "deepseek/deepseek-v4-pro",
    }
)

# Models that frequently return malformed / truncated / empty structured
# output. Allowed, but never used in default presets and flagged in the UI.
EXPERIMENTAL_STRUCTURED_MODELS: frozenset[str] = frozenset(
    {
        "xiaomi/mimo-v2.5",
        "xiaomi/mimo-v2.5-pro",
        "google/gemini-3.5-flash",
        "google/gemini-2.0-flash-lite-001",
        "deepseek/deepseek-v4-flash",
        "xai/grok-4.3",
        "moonshot/kimi-k2.5",
        "moonshot/kimi-k2.6",
        "meta-llama/llama-3.1-8b-instruct",
    }
)

_EXPERIMENTAL_WARNING = "This model may produce malformed structured output."


def is_experimental_model(model: str | None) -> bool:
    """True if the model is known to be unreliable for structured output."""
    if not model:
        return False
    return model in EXPERIMENTAL_STRUCTURED_MODELS


def is_stable_model(model: str | None) -> bool:
    """True if the model is on the stable structured-output list."""
    if not model:
        return False
    return model in STABLE_STRUCTURED_MODELS


def stability_tier(model: str | None) -> str:
    """Return one of ``"stable"``, ``"experimental"``, or ``"unknown"``."""
    if is_stable_model(model):
        return "stable"
    if is_experimental_model(model):
        return "experimental"
    return "unknown"


def stability_warning(model: str | None) -> str | None:
    """User-facing warning string for experimental models, else ``None``."""
    return _EXPERIMENTAL_WARNING if is_experimental_model(model) else None


__all__ = [
    "STABLE_STRUCTURED_MODELS",
    "EXPERIMENTAL_STRUCTURED_MODELS",
    "is_experimental_model",
    "is_stable_model",
    "stability_tier",
    "stability_warning",
]
