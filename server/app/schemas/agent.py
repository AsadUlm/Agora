import uuid

from pydantic import BaseModel, model_validator

from app.schemas.agent_config import AgentConfig


class AgentCreate(BaseModel):
    """
    Input schema for a single agent when starting a debate.

    Backward compatible: ``{"role": "critic"}`` still works.
    Rich config: ``{"role": "critic", "config": {"model": {"provider": "groq", ...}}}``
    is validated and normalised into a typed ``AgentConfig``.
    """

    role: str
    config: dict = {}

    # Parsed (typed) version — populated by the validator below.
    parsed_config: AgentConfig | None = None

    @model_validator(mode="after")
    def _parse_config(self) -> "AgentCreate":
        self.parsed_config = AgentConfig.from_raw(self.config)
        return self

    model_config = {"json_schema_extra": {"examples": [
        {"role": "economist"},
        {"role": "ethicist", "config": {"model": {"provider": "groq", "model": "llama-3.3-70b-versatile"}}},
    ]}}


class AgentResponse(BaseModel):
    """Output schema for an agent record."""

    id: uuid.UUID
    role: str
    config: dict

    model_config = {"from_attributes": True}
