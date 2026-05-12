"""
Debate API routes.

POST /debates/start          — Start a new debate session (async, returns immediately).
GET  /debates/{id}           — Full session detail (agents + latest turn + rounds + messages).
GET  /debates/{id}/turns/{turn_id} — Single turn detail (rounds + messages).
GET  /debates                — List all debates for the current user.

Async execution model (Step 4)
-------------------------------
POST /debates/start no longer blocks until all rounds complete.
Instead it:
  1. Creates session / agents / turn / user-question message
  2. Commits to DB immediately so the background task can safely open its own session
  3. Schedules ChatEngine execution via FastAPI BackgroundTasks
  4. Returns 201 with status="queued" and WebSocket subscription URLs

The frontend should:
  - Subscribe to WS /ws/chat-turns/{turn_id} immediately after receiving the response
  - Receive real-time events (turn_started, message_created, turn_completed, …)
  - Call GET /debates/{debate_id} once turn_completed is received for the final snapshot

Step 6 — DTO shaping:
  GET /debates/{id} now returns SessionDetailDTO (nested, frontend-ready).
  GET /debates/{id}/turns/{turn_id} returns TurnDTO.
  serialize_session() / serialize_turn() handle the ORM → DTO translation.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import settings
from app.db.session import get_db, get_session_factory
from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message, MessageType, MessageVisibility, SenderType
from app.models.round import Round
from app.models.user import User
from app.models.agent_document_binding import AgentDocumentBinding
from app.models.debate_follow_up import DebateFollowUp
from app.schemas.agent_config import AgentConfig
from app.schemas.debate import (
    DebateListItem,
    DebateStartRequest,
    DebateStartResponse,
    FollowUpCreateRequest,
    FollowUpCreateResponse,
    SessionDetailDTO,
    TurnDTO,
)
from app.schemas.dto import serialize_session, serialize_turn, _agents_index
from app.services.execution_runner import run_turn_background
from app.services.followup_runner import run_followup_cycle
from app.services.ws_manager import ws_manager

router = APIRouter()


# ── Shared eager-load option set ──────────────────────────────────────────────

def _session_load_opts():
    """SQLAlchemy options that fully populate a ChatSession for serialization."""
    return [
        selectinload(ChatSession.chat_agents).selectinload(
            ChatAgent.document_bindings
        ),
        selectinload(ChatSession.chat_turns)
        .selectinload(ChatTurn.rounds)
        .selectinload(Round.messages),
        selectinload(ChatSession.chat_turns)
        .selectinload(ChatTurn.messages),
        selectinload(ChatSession.follow_ups),
    ]


# ── POST /debates/start ───────────────────────────────────────────────────────

@router.post("/start", response_model=DebateStartResponse, status_code=status.HTTP_201_CREATED)
async def start_debate(
    request: DebateStartRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_factory=Depends(get_session_factory),
) -> DebateStartResponse:
    """
    Start a new debate session (async execution model).

    Creates the session, agents, turn, and user-question message, then
    enqueues background execution and returns immediately with status='queued'.

    The client should subscribe to the WebSocket endpoints provided in the
    response (ws_turn_url or ws_session_url) to receive live progress events.
    Once 'turn_completed' is received, call GET /debates/{debate_id} for the
    full persisted result.
    """
    if not request.agents:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one agent is required.",
        )

    # ── 1. Create or reuse ChatSession ─────────────────────────────────────
    if request.session_id:
        stmt = select(ChatSession).where(
            ChatSession.id == request.session_id,
            ChatSession.user_id == current_user.id,
        )
        row = await db.execute(stmt)
        session = row.scalar_one_or_none()
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Session not found or access denied.",
            )
        session.title = request.question[:255]
    else:
        session = ChatSession(user_id=current_user.id, title=request.question[:255])
        db.add(session)
    await db.flush()

    # ── 2. Create ChatAgents ─────────────────────────────────────────────────
    agent_records: list[ChatAgent] = []
    for i, agent_req in enumerate(request.agents):
        cfg = AgentConfig.from_raw(agent_req.config)
        agent = ChatAgent(
            chat_session_id=session.id,
            name=agent_req.role,
            role=agent_req.role,
            provider=cfg.model.provider or settings.LLM_PROVIDER,
            model=cfg.model.model or settings.LLM_MODEL,
            temperature=(
                cfg.model.temperature
                if cfg.model.temperature is not None
                else settings.LLM_TEMPERATURE
            ),
            reasoning_style=cfg.reasoning.style,
            position_order=i,
            is_active=True,
            knowledge_mode=cfg.knowledge.mode,
            knowledge_strict=cfg.knowledge.strict,
        )
        db.add(agent)
        agent_records.append((agent, agent_req.document_ids))
    await db.flush()

    # ── 2b. Create AgentDocumentBindings ──────────────────────────────────────
    for agent, doc_ids in agent_records:
        for doc_id in doc_ids:
            binding = AgentDocumentBinding(
                chat_agent_id=agent.id,
                document_id=doc_id,
            )
            db.add(binding)
    await db.flush()

    # ── 3. Create ChatTurn (queued — background task transitions it to running)
    mode = request.execution_mode if request.execution_mode in ("auto", "manual") else "auto"
    turn = ChatTurn(
        chat_session_id=session.id,
        turn_index=1,
        status=ChatTurnStatus.queued,
        execution_mode=mode,
    )
    db.add(turn)
    await db.flush()

    # ── 4. Save user question as Message ─────────────────────────────────────
    user_message = Message(
        chat_session_id=session.id,
        chat_turn_id=turn.id,
        round_id=None,
        chat_agent_id=None,
        sender_type=SenderType.user,
        message_type=MessageType.user_input,
        visibility=MessageVisibility.visible,
        content=request.question,
        sequence_no=0,
    )
    db.add(user_message)

    # ── 5. Commit NOW so the background task can open its own session safely ─
    await db.commit()

    # ── 6. Schedule background debate execution ───────────────────────────────
    background_tasks.add_task(
        run_turn_background,
        turn_id=turn.id,
        session_id=session.id,
        on_event=ws_manager.emit,
        session_factory=session_factory,
    )

    return DebateStartResponse(
        debate_id=session.id,
        turn_id=turn.id,
        question=request.question,
        status="queued",
        ws_session_url=f"/ws/chat-sessions/{session.id}",
        ws_turn_url=f"/ws/chat-turns/{turn.id}",
    )


# ── GET /debates/{id} ─────────────────────────────────────────────────────────

@router.get("/{debate_id}", response_model=SessionDetailDTO)
async def get_debate(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionDetailDTO:
    """
    Return full session detail including agents and latest turn.

    Response shape (Step 6):
        {
          "id", "title", "question", "status", "created_at", "updated_at",
          "agents": [{id, role, provider, model, temperature, reasoning_style, position_order}],
          "latest_turn": {
            "id", "turn_index", "status", "started_at", "ended_at",
            "user_message": {"content", "created_at"},
            "rounds": [
              {
                "id", "round_number", "round_type", "status", "started_at", "ended_at",
                "messages": [
                  {id, agent_id, agent_role, message_type, sender_type, payload, text,
                   sequence_no, created_at}
                ]
              }
            ],
            "final_summary": {...} | null
          }
        }

    Only the session owner can view their debate.
    """
    stmt = (
        select(ChatSession)
        .where(ChatSession.id == debate_id)
        .where(ChatSession.user_id == current_user.id)
        .options(*_session_load_opts())
    )
    row = await db.execute(stmt)
    session = row.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Debate {debate_id} not found.",
        )

    return serialize_session(session)


# ── POST /debates/{id}/follow-ups ─────────────────────────────────────────────

@router.post(
    "/{debate_id}/follow-ups",
    response_model=FollowUpCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_follow_up(
    debate_id: uuid.UUID,
    request: FollowUpCreateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_factory=Depends(get_session_factory),
) -> FollowUpCreateResponse:
    """Open a new debate cycle by asking a follow-up question.

    Behavior (per spec):
      - Validates session ownership
      - Validates that the debate is not currently generating
      - Determines the next ``cycle_number`` (latest existing + 1, min 2)
      - Persists a ``DebateFollowUp`` record
      - Schedules ``run_followup_cycle`` in the background
      - Returns 201 immediately so the UI can subscribe over WebSocket
    """
    question = (request.question or "").strip()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Follow-up question must not be empty.",
        )

    # 1. Ownership + load latest turn with rounds
    session_check = await db.execute(
        select(ChatSession.id)
        .where(ChatSession.id == debate_id)
        .where(ChatSession.user_id == current_user.id)
    )
    if session_check.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    turn_row = await db.execute(
        select(ChatTurn)
        .where(ChatTurn.chat_session_id == debate_id)
        .options(selectinload(ChatTurn.rounds))
        .order_by(ChatTurn.turn_index.desc())
        .limit(1)
    )
    turn = turn_row.scalar_one_or_none()
    if turn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No debate turn exists yet for this session.",
        )

    # 2. Reject if the previous cycle is still running
    if turn.status in (ChatTurnStatus.queued, ChatTurnStatus.running):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A debate cycle is already in progress. Wait for it to finish.",
        )

    # 3. Determine next cycle_number — must be ≥ 2 (cycle 1 is the initial debate)
    existing_max_cycle = max(
        (r.cycle_number or 1 for r in turn.rounds),
        default=1,
    )
    cycle_number = max(existing_max_cycle + 1, 2)

    # 4. Persist follow-up record
    follow_up = DebateFollowUp(
        chat_session_id=debate_id,
        chat_turn_id=turn.id,
        question=question,
        cycle_number=cycle_number,
    )
    db.add(follow_up)
    await db.flush()

    # 5. Re-queue turn so the UI/back-end agree it's live again
    turn.status = ChatTurnStatus.queued
    turn.ended_at = None
    await db.commit()

    # 6. Background execution
    background_tasks.add_task(
        run_followup_cycle,
        session_id=debate_id,
        turn_id=turn.id,
        cycle_number=cycle_number,
        follow_up_question=question,
        on_event=ws_manager.emit,
        session_factory=session_factory,
    )

    return FollowUpCreateResponse(
        follow_up_id=follow_up.id,
        debate_id=debate_id,
        turn_id=turn.id,
        cycle_number=cycle_number,
        question=question,
        status="queued",
        ws_session_url=f"/ws/chat-sessions/{debate_id}",
        ws_turn_url=f"/ws/chat-turns/{turn.id}",
    )


# ── GET /debates/{id}/turns/{turn_id} ─────────────────────────────────────────

@router.get("/{debate_id}/turns/{turn_id}", response_model=TurnDTO)
async def get_turn(
    debate_id: uuid.UUID,
    turn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TurnDTO:
    """
    Return detailed turn data: user question + all rounds + messages.

    Ownership is verified via the parent session (session.user_id == current_user.id).

    Response shape:
        {
          "id", "turn_index", "status", "started_at", "ended_at",
          "user_message": {"content", "created_at"},
          "rounds": [
            {"id", "round_number", "round_type", "status", "messages": [...]}
          ],
          "final_summary": {...} | null
        }
    """
    # Verify ownership via the parent session in one query
    session_check = await db.execute(
        select(ChatSession.id)
        .where(ChatSession.id == debate_id)
        .where(ChatSession.user_id == current_user.id)
    )
    if session_check.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    stmt = (
        select(ChatTurn)
        .where(ChatTurn.id == turn_id)
        .where(ChatTurn.chat_session_id == debate_id)
        .options(
            selectinload(ChatTurn.rounds).selectinload(Round.messages),
            selectinload(ChatTurn.messages),
        )
    )
    row = await db.execute(stmt)
    turn = row.scalar_one_or_none()

    if turn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turn not found.")

    # Load agents for role denormalization
    agents_result = await db.execute(
        select(ChatAgent).where(ChatAgent.chat_session_id == debate_id)
    )
    agents = agents_result.scalars().all()
    agents_by_id = _agents_index(list(agents))

    return serialize_turn(turn, agents_by_id)


# ── POST /debates/{id}/next-step ──────────────────────────────────────────────

@router.post("/{debate_id}/next-step", status_code=status.HTTP_200_OK)
async def next_step(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Release exactly one pending step in manual-mode execution.

    Behavior:
      - If the active turn is in manual mode and currently waiting on the
        StepController gate, releases it. The engine then runs one agent
        and pauses again.
      - If the gate is already running, returns 409.
      - If the turn has already completed, returns its status.
      - If the turn is in auto mode, this is a no-op success.

    Returns:
        {
          "turn_id": "...",
          "status": "queued"|"running"|"completed"|"failed",
          "execution_mode": "auto"|"manual",
          "released": true|false,
          "pending_step": {...} | null,   # what is about to run (if any)
        }
    """
    from app.services.debate_engine.step_controller import step_controller

    # Ownership check + load latest turn
    stmt = (
        select(ChatTurn)
        .join(ChatSession, ChatTurn.chat_session_id == ChatSession.id)
        .where(ChatSession.id == debate_id, ChatSession.user_id == current_user.id)
        .order_by(ChatTurn.turn_index.desc())
        .limit(1)
    )
    turn = (await db.execute(stmt)).scalar_one_or_none()
    if turn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    if turn.status in (ChatTurnStatus.completed, ChatTurnStatus.failed, ChatTurnStatus.cancelled):
        return {
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "execution_mode": turn.execution_mode,
            "released": False,
            "pending_step": None,
        }

    snap = step_controller.snapshot(turn.id)
    if snap is None:
        # Background task hasn't registered yet — not an error, just not ready.
        return {
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "execution_mode": turn.execution_mode,
            "released": False,
            "pending_step": None,
            "reason": "not_ready",
        }
    if snap["is_running"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A step is currently running. Wait for it to complete.",
        )

    released = await step_controller.release_step(turn.id)
    logger.info(
        "POST /debates/%s/next-step turn=%s status=%s mode=%s released=%s pending=%s",
        debate_id,
        turn.id,
        turn.status.value,
        turn.execution_mode,
        released,
        snap.get("pending_step"),
    )
    return {
        "turn_id": str(turn.id),
        "status": turn.status.value,
        "execution_mode": turn.execution_mode,
        "released": released,
        "pending_step": snap.get("pending_step"),
    }


# ── GET /debates/{id}/step-state ─────────────────────────────────────────────

@router.get("/{debate_id}/step-state", status_code=status.HTTP_200_OK)
async def get_step_state(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Read-only snapshot of the StepController for the latest turn.

    Lets the client recover from missed ``agent_started`` WebSocket events
    (e.g. when the WS opens after the engine has already paused at a gate).
    Never releases the gate.

    Returns:
        {
          "turn_id":        "<uuid>",
          "status":         "queued"|"running"|"completed"|"failed"|"cancelled",
          "execution_mode": "auto"|"manual",
          "is_running":     bool,
          "pending_step":   {...} | null,
          "gate_set":       bool,
        }
    """
    from app.services.debate_engine.step_controller import step_controller

    stmt = (
        select(ChatTurn)
        .join(ChatSession, ChatTurn.chat_session_id == ChatSession.id)
        .where(ChatSession.id == debate_id, ChatSession.user_id == current_user.id)
        .order_by(ChatTurn.turn_index.desc())
        .limit(1)
    )
    turn = (await db.execute(stmt)).scalar_one_or_none()
    if turn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    snap = step_controller.snapshot(turn.id)
    return {
        "turn_id": str(turn.id),
        "status": turn.status.value,
        "execution_mode": turn.execution_mode,
        "is_running": bool(snap and snap.get("is_running")),
        "pending_step": snap.get("pending_step") if snap else None,
        "gate_set": bool(snap and snap.get("gate_set")),
    }


# ── POST /debates/{id}/auto-run ───────────────────────────────────────────────

@router.post("/{debate_id}/resume", status_code=status.HTTP_200_OK)
async def resume_debate(
    debate_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_factory=Depends(get_session_factory),
) -> dict:
    """
    Requeue a stalled queued turn.

    Safety guards:
      - only for latest turn owned by current user
      - only when status is queued
      - only when StepController has no pending/running step
      - only after a short warm-up window (prevents duplicate runners)
    """
    from app.services.debate_engine.step_controller import step_controller

    stmt = (
        select(ChatTurn)
        .join(ChatSession, ChatTurn.chat_session_id == ChatSession.id)
        .where(ChatSession.id == debate_id, ChatSession.user_id == current_user.id)
        .order_by(ChatTurn.turn_index.desc())
        .limit(1)
    )
    turn = (await db.execute(stmt)).scalar_one_or_none()
    if turn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    if turn.status != ChatTurnStatus.queued:
        return {
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "resumed": False,
            "reason": "not_queued",
        }

    snap = step_controller.snapshot(turn.id)
    if snap is not None and (snap.get("is_running") or snap.get("pending_step") is not None):
        return {
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "resumed": False,
            "reason": "already_active",
        }

    age_s = (datetime.now(timezone.utc) - turn.created_at).total_seconds()
    if age_s < 15:
        return {
            "turn_id": str(turn.id),
            "status": turn.status.value,
            "resumed": False,
            "reason": "warming_up",
        }

    # Drop stale gate state (if any) and start a fresh background runner.
    await step_controller.cleanup(turn.id)
    background_tasks.add_task(
        run_turn_background,
        turn_id=turn.id,
        session_id=turn.chat_session_id,
        on_event=ws_manager.emit,
        session_factory=session_factory,
    )

    return {
        "turn_id": str(turn.id),
        "status": turn.status.value,
        "resumed": True,
    }


# ── POST /debates/{id}/auto-run ───────────────────────────────────────────────

@router.post("/{debate_id}/auto-run", status_code=status.HTTP_200_OK)
async def switch_auto_run(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Switch a manual-mode debate into auto execution: releases the gate
    permanently so all subsequent steps run without further /next-step calls.
    No-op if the debate is already auto / completed.
    """
    from app.services.debate_engine.step_controller import step_controller

    stmt = (
        select(ChatTurn)
        .join(ChatSession, ChatTurn.chat_session_id == ChatSession.id)
        .where(ChatSession.id == debate_id, ChatSession.user_id == current_user.id)
        .order_by(ChatTurn.turn_index.desc())
        .limit(1)
    )
    turn = (await db.execute(stmt)).scalar_one_or_none()
    if turn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Debate not found.")

    turn.execution_mode = "auto"
    await db.commit()
    switched = await step_controller.switch_mode(turn.id, "auto")
    return {
        "turn_id": str(turn.id),
        "status": turn.status.value,
        "execution_mode": "auto",
        "switched": switched,
    }



# ── GET /debates ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[DebateListItem])
async def list_debates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DebateListItem]:
    """Return a summary list of all debates for the authenticated user."""
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .options(selectinload(ChatSession.chat_turns))
        .order_by(ChatSession.created_at.desc())
    )
    rows = await db.execute(stmt)
    sessions = rows.scalars().all()

    result = []
    for s in sessions:
        turn_status = "unknown"
        if s.chat_turns:
            turn_status = s.chat_turns[0].status.value
        result.append(
            DebateListItem(
                id=s.id,
                title=s.title or "",
                question=s.title or "",
                status=turn_status,
                created_at=s.created_at,
            )
        )
    return result
