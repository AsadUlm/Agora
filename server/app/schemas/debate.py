import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.schemas.agent import AgentCreate


# ── Request schemas ────────────────────────────────────────────────────────────

class DebateStartRequest(BaseModel):
    """Request body for POST /debates/start."""

    question: str
    agents: list[AgentCreate]
    session_id: uuid.UUID | None = None
    # "auto" runs the entire debate without pausing (legacy behavior).
    # "manual" pauses before each agent until /debates/{id}/next-step is called.
    execution_mode: str = "auto"


# ── Response schemas (Step 6 — structured, frontend-ready) ────────────────────

class AgentDTO(BaseModel):
    """Full agent info embedded in session and message responses."""

    id: uuid.UUID
    role: str
    provider: str
    model: str
    temperature: float | None
    reasoning_style: str | None
    position_order: int | None
    knowledge_mode: str | None
    knowledge_strict: bool | None
    document_ids: list[uuid.UUID] = []


class MessageDTO(BaseModel):
    """
    Single debate message with agent info denormalized.

    `payload` is the parsed JSON content (structured fields from the LLM).
    `text` is always the raw string content as fallback.
    """

    id: uuid.UUID
    agent_id: uuid.UUID | None
    agent_role: str | None
    message_type: str           # agent_response | critique | final_summary | …
    sender_type: str            # agent | user | system
    payload: dict[str, Any]    # parsed JSON or {"text": <raw content>}
    text: str                   # raw LLM output
    sequence_no: int
    created_at: datetime


class RoundDTO(BaseModel):
    """
    One debate round with all agent messages pre-grouped.

    Frontend can render directly without cross-referencing agent IDs.
    """

    id: uuid.UUID
    round_number: int
    round_type: str             # initial | critique | final
    status: str                 # queued | running | completed | failed
    started_at: datetime | None
    ended_at: datetime | None
    messages: list[MessageDTO]  # sorted by sequence_no, agents only


class UserMessageDTO(BaseModel):
    """The user's question that triggered this turn."""

    content: str
    created_at: datetime


class TurnDTO(BaseModel):
    """
    Complete debate turn: user question + all three rounds + optional summary.

    This is the primary payload frontend uses to render the full debate.
    """

    id: uuid.UUID
    turn_index: int
    status: str                         # queued | running | completed | failed
    execution_mode: str = "auto"        # auto | manual
    started_at: datetime | None
    ended_at: datetime | None
    user_message: UserMessageDTO | None
    rounds: list[RoundDTO]              # sorted by round_number
    final_summary: dict[str, Any] | None  # from last round's final_summary messages


class SessionDetailDTO(BaseModel):
    """
    Full session detail: metadata + agents + latest turn (full debate).

    Replaces the old DebateResponse. Designed for a single GET to give
    the frontend everything it needs to render the debate page.
    """

    id: uuid.UUID
    title: str
    question: str               # convenience alias for latest_turn.user_message.content
    status: str                 # equals latest_turn.status
    created_at: datetime
    updated_at: datetime
    agents: list[AgentDTO]      # sorted by position_order
    latest_turn: TurnDTO | None


# ── Start / list (unchanged) ──────────────────────────────────────────────────

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
    question: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
