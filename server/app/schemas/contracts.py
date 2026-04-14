"""
Internal execution contracts for the debate backend.

These are typed Pydantic models used as boundaries between backend services.
They are NOT public API DTOs — they never leave the backend.

Contracts defined here:
  - LLMRequest       — input to any LLM provider
  - LLMResponse      — output from any LLM provider
  - TurnContext       — full context for a single debate turn
  - RoundContext      — context for one round within a turn
  - RetrievedChunk   — a single RAG search result
  - ExecutionEvent   — progress event for WebSocket streaming
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ── LLM Service Contracts ─────────────────────────────────────────────────────

class LLMRequest(BaseModel):
    """Input contract for a single LLM call."""

    provider: str
    model: str
    prompt: str
    temperature: float = 0.7
    max_tokens: int | None = None
    # Arbitrary extra params passed to the provider
    extra: dict[str, Any] = Field(default_factory=dict)


class LLMResponse(BaseModel):
    """Output contract from a single LLM call."""

    content: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    raw: dict[str, Any] = Field(default_factory=dict)


# ── RAG Contracts ─────────────────────────────────────────────────────────────

class RetrievedChunk(BaseModel):
    """A single chunk returned by the vector retrieval service."""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    chunk_index: int
    content: str
    similarity_score: float  # cosine similarity 0.0 – 1.0


# ── Debate Execution Contracts ────────────────────────────────────────────────

class AgentContext(BaseModel):
    """Minimal agent data carried through the debate engine."""

    agent_id: uuid.UUID
    role: str
    provider: str
    model: str
    temperature: float
    reasoning_style: str = "balanced"
    reasoning_depth: str = "normal"
    system_prompt: str = ""


class AgentRoundResult(BaseModel):
    """
    Result of one agent executing one round.

    Produced by the RoundManager and aggregated into the full turn result.
    Not stored directly — the Message and LLMCall records hold the persisted form.
    """

    agent_id: uuid.UUID
    role: str
    content: str                        # Raw text content from LLM
    structured: dict[str, Any] = Field(default_factory=dict)  # Parsed JSON (if any)
    generation_status: str = "success"  # "success" | "failed"
    error: str | None = None


class RoundContext(BaseModel):
    """Context for executing a single round within a turn."""

    round_id: uuid.UUID
    round_number: int          # 1, 2, or 3
    round_type: str            # initial | critique | final
    question: str
    agents: list[AgentContext]
    # Results from previous rounds (empty for round 1)
    prior_round_results: list[dict[str, Any]] = Field(default_factory=list)
    # RAG chunks relevant to this round
    retrieved_chunks: list[RetrievedChunk] = Field(default_factory=list)


class TurnContext(BaseModel):
    """
    Full context for executing one debate turn.

    Passed into the debate engine and used to coordinate all three rounds.
    """

    turn_id: uuid.UUID
    session_id: uuid.UUID
    user_id: uuid.UUID
    question: str
    agents: list[AgentContext]
    turn_index: int = 1


# ── WebSocket / Streaming Contracts ──────────────────────────────────────────

class ExecutionEventType(str, Enum):
    turn_started = "turn_started"
    round_started = "round_started"
    agent_started = "agent_started"
    agent_completed = "agent_completed"
    message_created = "message_created"
    round_completed = "round_completed"
    turn_completed = "turn_completed"
    turn_failed = "turn_failed"


class ExecutionEvent(BaseModel):
    """
    Progress event emitted during debate execution.

    Used for:
    - WebSocket streaming to the frontend
    - Internal progress tracking
    """

    event_type: ExecutionEventType
    session_id: uuid.UUID
    turn_id: uuid.UUID
    round_id: uuid.UUID | None = None
    round_number: int | None = None
    agent_id: uuid.UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Step 3 readiness: event callback type ────────────────────────────────────

# Signature for any async function that receives an ExecutionEvent.
# Usage:
#   async def broadcast(event: ExecutionEvent) -> None:
#       await websocket_manager.emit(event)
#
#   engine = ChatEngine(db, on_event=broadcast)
OnEventCallback = Callable[[ExecutionEvent], Awaitable[None]]
