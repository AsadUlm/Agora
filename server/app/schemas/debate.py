import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.agent import AgentCreate, AgentResponse


class DebateStartRequest(BaseModel):
    """Request body for POST /debates/start."""

    question: str
    agents: list[AgentCreate]


class RoundResponse(BaseModel):
    """Output schema for a single round record."""

    id: uuid.UUID
    round_number: int
    data: list | dict

    model_config = {"from_attributes": True}


class DebateResponse(BaseModel):
    """Full debate detail response including agents and rounds."""

    id: uuid.UUID
    question: str
    status: str
    created_at: datetime
    agents: list[AgentResponse]
    rounds: list[RoundResponse]

    model_config = {"from_attributes": True}


class DebateStartResponse(BaseModel):
    """Response body for POST /debates/start."""

    debate_id: uuid.UUID
    question: str
    status: str
    result: dict
