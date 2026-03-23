import uuid

from pydantic import BaseModel


class AgentCreate(BaseModel):
    """Input schema for a single agent when starting a debate."""

    role: str
    config: dict = {}


class AgentResponse(BaseModel):
    """Output schema for an agent record."""

    id: uuid.UUID
    role: str
    config: dict

    model_config = {"from_attributes": True}
