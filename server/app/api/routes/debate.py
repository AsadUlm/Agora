"""
Debate API routes.

POST /debates/start      — Start a new debate session (async, returns immediately).
GET  /debates/{id}       — Retrieve full debate result by session ID.
GET  /debates            — List all debates for the current user.

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
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message, MessageType, MessageVisibility, SenderType
from app.models.round import Round
from app.models.user import User
from app.schemas.agent_config import AgentConfig
from app.schemas.debate import (
    DebateListItem,
    DebateResponse,
    DebateStartRequest,
    DebateStartResponse,
)
from app.services.execution_runner import run_turn_background
from app.services.ws_manager import ws_manager
from app.db.session import get_session_factory

router = APIRouter()


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

    # ── 1. Create ChatSession ────────────────────────────────────────────────
    session = ChatSession(user_id=current_user.id, title=request.question[:255])
    db.add(session)
    await db.flush()

    # ── 2. Create ChatAgents ─────────────────────────────────────────────────
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
        )
        db.add(agent)
    await db.flush()

    # ── 3. Create ChatTurn (queued — background task transitions it to running)
    turn = ChatTurn(
        chat_session_id=session.id,
        turn_index=1,
        status=ChatTurnStatus.queued,
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
    #
    # We commit explicitly here rather than relying on get_db's cleanup commit.
    # This guarantees the data is in the DB before any background task starts,
    # regardless of the exact ordering of FastAPI BackgroundTasks vs dependency
    # cleanup. get_db will find nothing left to commit and exits cleanly.
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


@router.get("/{debate_id}", response_model=DebateResponse)
async def get_debate(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DebateResponse:
    """
    Return full debate detail including all rounds and agent messages.

    Only the session owner can view their debate.
    """
    stmt = (
        select(ChatSession)
        .where(ChatSession.id == debate_id)
        .where(ChatSession.user_id == current_user.id)
        .options(
            selectinload(ChatSession.chat_agents),
            selectinload(ChatSession.chat_turns)
            .selectinload(ChatTurn.rounds)
            .selectinload(Round.messages),
            selectinload(ChatSession.chat_turns)
            .selectinload(ChatTurn.messages),
        )
    )
    row = await db.execute(stmt)
    session = row.scalar_one_or_none()

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Debate {debate_id} not found.",
        )

    # Recover the original question from the user_input message
    question = session.title or ""
    for turn in session.chat_turns:
        for msg in turn.messages:
            if msg.message_type == MessageType.user_input:
                question = msg.content
                break

    rounds_out = []
    for turn in session.chat_turns:
        for round_obj in sorted(turn.rounds, key=lambda r: r.round_number):
            agent_outputs = []
            for msg in sorted(round_obj.messages, key=lambda m: m.sequence_no):
                if msg.sender_type != SenderType.agent:
                    continue
                try:
                    structured = json.loads(msg.content)
                except (json.JSONDecodeError, TypeError):
                    structured = {"raw_content": msg.content}
                agent_outputs.append({
                    "agent_id": str(msg.chat_agent_id),
                    "message_type": msg.message_type.value,
                    "data": structured,
                })
            rounds_out.append({
                "id": str(round_obj.id),
                "round_number": round_obj.round_number,
                "round_type": round_obj.round_type.value,
                "status": round_obj.status.value,
                "data": agent_outputs,
            })

    turn_status = "unknown"
    if session.chat_turns:
        turn_status = session.chat_turns[0].status.value

    return DebateResponse(
        id=session.id,
        question=question,
        status=turn_status,
        created_at=session.created_at,
        agents=[
            {"id": str(a.id), "role": a.role, "config": {}}
            for a in session.chat_agents
        ],
        rounds=rounds_out,
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /debates
# ─────────────────────────────────────────────────────────────────────────────

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
                status=turn_status,
                created_at=s.created_at,
            )
        )
    return result
