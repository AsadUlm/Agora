import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.agent import AgentCreate


class DebateStartRequest(BaseModel):
    """Request body for POST /debates/start."""

    question: str
    agents: list[AgentCreate]


class RoundResponse(BaseModel):
    """Output schema for a single round record."""

    id: str
    round_number: int
    data: list | dict

    model_config = {"from_attributes": True}


class AgentResponse(BaseModel):
    id: str
    role: str
    config: dict = {}

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
    """Response body for POST /debates/start (async execution model)."""

    debate_id: uuid.UUID
    turn_id: uuid.UUID
    question: str
    status: str  # always 'queued' — execution runs in the background
    ws_session_url: str  # e.g. /ws/chat-sessions/{debate_id}
    ws_turn_url: str     # e.g. /ws/chat-turns/{turn_id}


class DebateListItem(BaseModel):
    """Summary row for GET /debates list."""

    id: uuid.UUID
    title: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DebateListItem(BaseModel):
    """Summary row for GET /debates list."""

    id: uuid.UUID
    title: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}

