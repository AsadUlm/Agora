"""
Internal agent configuration schema.

AgentConfig is the canonical internal representation of how a single
debate agent is configured. It is NOT a public API DTO — it is used
only inside the backend service layer.

Public-facing agent creation uses AgentCreate (schemas/agent.py),
which carries raw config dict that is parsed into AgentConfig here.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class IdentityConfig(BaseModel):
    """Optional agent identity metadata."""

    name: str = ""
    description: str = ""


class ModelConfig(BaseModel):
    """LLM model selection for an agent."""

    provider: str = ""
    model: str = ""
    temperature: float | None = None


class ReasoningConfig(BaseModel):
    """How the agent reasons and structures its output."""

    style: str = "balanced"   # analytical | creative | balanced | devil_advocate | ...
    depth: str = "normal"     # shallow | normal | deep


class AgentConfig(BaseModel):
    """
    Canonical internal representation of a debate agent's configuration.

    Built from the raw `config` dict supplied at debate creation time.
    Use `AgentConfig.from_raw(raw_dict)` to parse safely.
    """

    identity: IdentityConfig = Field(default_factory=IdentityConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    system_prompt: str = ""

    @classmethod
    def from_raw(cls, raw: dict) -> "AgentConfig":
        """
        Parse a raw config dict (from the API request) into AgentConfig.

        Handles:
        - Empty dict           → all defaults
        - Flat legacy dicts    → ignored, returns defaults
        - Nested structured    → parsed properly
        """
        if not isinstance(raw, dict):
            return cls()

        data: dict = {}

        if "identity" in raw and isinstance(raw["identity"], dict):
            data["identity"] = raw["identity"]

        if "model" in raw and isinstance(raw["model"], dict):
            data["model"] = raw["model"]

        if "reasoning" in raw and isinstance(raw["reasoning"], dict):
            data["reasoning"] = raw["reasoning"]

        if "system_prompt" in raw and isinstance(raw["system_prompt"], str):
            data["system_prompt"] = raw["system_prompt"]

        return cls.model_validate(data)
