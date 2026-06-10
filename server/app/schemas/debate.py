import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.schemas.agent import AgentCreate


# ── Debate Trace Schema ────────────────────────────────────────────────────────

class CritiqueTraceItem(BaseModel):
    """One critique edge in the debate trace: from_agent → to_agent."""
    id: str
    from_agent_id: str
    from_agent_name: str
    to_agent_id: str
    to_agent_name: str
    target_claim: str
    critique_summary: str
    weakness_found: str
    severity: str = "medium"


class CritiqueResponseTraceItem(BaseModel):
    """One agent's response to critiques in the debate trace."""
    id: str
    agent_id: str
    agent_name: str
    received_critique_summary: str
    response: str
    accepted_points: list[str] = []
    rejected_points: list[str] = []
    planned_revision: str
    stance_update: str = "unchanged"


class RevisedPositionTraceItem(BaseModel):
    """One agent's revised position with explicit change tracking."""
    id: str
    agent_id: str
    agent_name: str
    initial_position_summary: str
    revised_position: str
    change_summary: str
    changed: bool
    change_type: str
    reason_for_change: str
    key_claims: list[str] = []


class UsedPoint(BaseModel):
    """A revised position point referenced in the final synthesis."""
    agent_id: str
    agent_name: str
    source_round: str
    point: str


class ImportantChange(BaseModel):
    """An agent that changed their position during the debate."""
    agent_id: str
    agent_name: str
    before: str
    after: str
    why_changed: str


class DebateImpact(BaseModel):
    """Summary of how the debate affected the final answer."""
    initial_consensus: str = ""
    major_disagreements: list[str] = []
    important_changes: list[ImportantChange] = []
    how_debate_improved_answer: str = ""
    single_llm_risk_avoided: str = ""


class DebateTrace(BaseModel):
    """
    Full structured trace of the 5-stage debate.

    Used by:
    - Debate History tab (chronological view)
    - Agent Evolution tab (per-agent before/after)
    - Graph view (semantic node/edge data)
    - Evaluation / traceability proof
    """
    critiques: list[CritiqueTraceItem] = []
    critique_responses: list[CritiqueResponseTraceItem] = []
    revised_positions: list[RevisedPositionTraceItem] = []
    debate_impact: DebateImpact | None = None


# ── Request schemas ────────────────────────────────────────────────────────────

class DebateStartRequest(BaseModel):
    """Request body for POST /debates/start."""

    question: str
    agents: list[AgentCreate]
    session_id: uuid.UUID | None = None
    # "auto" runs the entire debate without pausing (legacy behavior).
    # "manual" pauses before each agent until /debates/{id}/next-step is called.
    execution_mode: str = "auto"

    @field_validator("question")
    @classmethod
    def validate_question_basic(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Debate topic must not be empty.")
        if len(stripped) > 2000:
            raise ValueError("Debate topic is too long (max 2000 characters).")
        return stripped

    @field_validator("agents")
    @classmethod
    def validate_max_agents(cls, agents: list[AgentCreate]) -> list[AgentCreate]:
        from app.core.config import settings
        max_agents = settings.MAX_DEBATE_AGENTS
        if agents and len(agents) > max_agents:
            raise ValueError(
                f"A debate can use at most {max_agents} agents. "
                f"Received {len(agents)}."
            )
        return agents


# ── Response schemas (Step 6 — structured, frontend-ready) ────────────────────

class AgentDTO(BaseModel):
    """Full agent info embedded in session and message responses."""

    id: uuid.UUID
    role: str
    provider: str
    model: str
    temperature: float | None
    reasoning_style: str | None
    reasoning_depth: str | None = None
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
    cycle_number: int = 1
    round_type: str             # initial | critique | final | followup_response | followup_critique | updated_synthesis
    status: str                 # queued | running | partially_completed | completed | failed
    started_at: datetime | None
    ended_at: datetime | None
    messages: list[MessageDTO]  # sorted by sequence_no, agents only


class FollowUpDTO(BaseModel):
    """User-asked follow-up question that opened a new debate cycle."""

    id: uuid.UUID
    chat_turn_id: uuid.UUID
    cycle_number: int
    question: str
    response_language_code: str = "en"
    response_language_name: str = "English"
    response_language_source: str = "fallback"
    response_language_confidence: float = 0.6
    created_at: datetime


class UserMessageDTO(BaseModel):
    """The user's question that triggered this turn."""

    content: str
    created_at: datetime


class TurnDTO(BaseModel):
    """
    Complete debate turn: user question + all rounds + optional summary.

    This is the primary payload frontend uses to render the full debate.
    """

    id: uuid.UUID
    turn_index: int
    status: str                         # queued | running | partially_completed | completed | failed
    current_stage: int | None = None
    synthesis_status: str = "pending"   # pending | running | completed | failed | skipped
    request_id: str | None = None
    error: dict[str, Any] | None = None
    execution_mode: str = "auto"        # auto | manual
    response_language_code: str = "en"
    response_language_name: str = "English"
    response_language_source: str = "fallback"
    response_language_confidence: float = 0.6
    started_at: datetime | None
    ended_at: datetime | None
    user_message: UserMessageDTO | None
    rounds: list[RoundDTO]              # sorted by round_number
    final_summary: dict[str, Any] | None  # from last round's final_summary messages
    follow_ups: list[FollowUpDTO] = []   # in cycle_number order
    debate_trace: DebateTrace | None = None  # structured trace for Debate History / Agent Evolution
    # Pipeline type flag: True when this turn used the 5-stage traceable pipeline.
    # Set by serialize_turn based on current_round_no > 3 OR presence of new round types.
    is_5stage_pipeline: bool = False


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
    response_language_code: str = "en"
    response_language_name: str = "English"
    response_language_source: str = "fallback"
    response_language_confidence: float = 0.6
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


class FollowUpCreateRequest(BaseModel):
    """Request body for POST /debates/{session_id}/follow-ups."""

    question: str


class FollowUpCreateResponse(BaseModel):
    """Response body for POST /debates/{session_id}/follow-ups."""

    follow_up_id: uuid.UUID
    debate_id: uuid.UUID
    turn_id: uuid.UUID
    cycle_number: int
    question: str
    status: str  # always 'queued' — runs in the background
    response_language_code: str = "en"
    response_language_name: str = "English"
    response_language_source: str = "fallback"
    response_language_confidence: float = 0.6
    ws_session_url: str
    ws_turn_url: str

