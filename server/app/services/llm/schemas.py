"""
Internal data contracts for the LLM service layer.

These schemas are used exclusively within the LLM module and are not
exposed as API response models.
"""

from pydantic import BaseModel, Field


class LLMRequest(BaseModel):
    """Encapsulates a single generation request."""

    prompt: str = Field(..., description="Fully-rendered prompt sent to the provider.")


class LLMResponse(BaseModel):
    """Encapsulates the result of a single generation call."""

    raw: str = Field(..., description="Raw string returned by the provider.")
    parsed: dict = Field(default_factory=dict, description="JSON-parsed content.")
    provider: str = Field(..., description="Name of the provider that handled the request.")
    parse_error: str | None = Field(
        default=None,
        description="Set when JSON parsing failed; raw field still contains original output.",
    )
