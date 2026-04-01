"""
Typed Agent Configuration Schema.

Defines the rich, nested configuration that an agent can carry.
All sections are optional with sensible defaults so that a minimal
payload like ``{"role": "critic"}`` keeps working without any config.

Sections:
  • identity  — display name, avatar, description
  • model     — provider, model name, temperature, max_tokens
  • reasoning — style preset, depth level
  • prompting — system prompt, few-shot examples
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class IdentityConfig(BaseModel):
    """Display-level identity for the agent."""

    name: str = ""
    avatar: str = ""
    description: str = ""


class ModelConfig(BaseModel):
    """Which LLM provider/model/params this agent should use."""

    provider: str = ""
    model: str = ""
    temperature: float | None = None
    max_tokens: int | None = None


class ReasoningConfig(BaseModel):
    """High-level reasoning style for the agent."""

    style: str = Field(
        default="balanced",
        description="Preset: analytical | creative | balanced | critical | formal",
    )
    depth: str = Field(
        default="normal",
        description="Depth level: shallow | normal | deep",
    )


class PromptingConfig(BaseModel):
    """Custom prompt overrides."""

    system_prompt: str = ""
    few_shot_examples: list[dict] = Field(default_factory=list)


class AgentConfig(BaseModel):
    """
    Full typed agent configuration.

    Every section is optional — omitted sections get safe defaults.
    The ``from_raw`` class method handles backward-compatible conversion
    from the legacy ``config: dict = {}`` format.
    """

    identity: IdentityConfig = Field(default_factory=IdentityConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    reasoning: ReasoningConfig = Field(default_factory=ReasoningConfig)
    prompting: PromptingConfig = Field(default_factory=PromptingConfig)

    @classmethod
    def from_raw(cls, raw: dict) -> AgentConfig:
        """
        Build an ``AgentConfig`` from an arbitrary dict.

        If the dict already has the typed structure (``identity``, ``model``, …)
        they are parsed directly.  Otherwise the dict is treated as legacy
        flat config and returned with all-default sections.
        """
        known_sections = {"identity", "model", "reasoning", "prompting"}
        if raw.keys() & known_sections:
            return cls.model_validate(raw)
        return cls()
