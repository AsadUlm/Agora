"""
Debate API routes.

POST /debates/start  — Start a new debate session (requires auth).
GET  /debates/{id}   — Retrieve debate result by session ID.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
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
from app.models.round import Round, RoundStatus, RoundType
from app.models.user import User
from app.schemas.debate import DebateResponse, DebateStartRequest, DebateStartResponse
from app.schemas.agent_config import AgentConfig
from app.services.debate_engine.engine import DebateEngine
from app.services.llm.exceptions import LLMError

router = APIRouter()

_ROUND_TYPE_MAP = {
    1: RoundType.initial,
    2: RoundType.critique,
    3: RoundType.final,
}
_ROUND_KEY_MAP = {
    1: "round1",
    2: "round2",
    3: "round3",
}


@router.post("/start", response_model=DebateStartResponse, status_code=201)
async def start_debate(
    request: DebateStartRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DebateStartResponse:
    """Start a new debate session, run the engine, persist results."""

    # 1. Create ChatSession
    session = ChatSession(user_id=current_user.id, title=request.question[:255])
    db.add(session)
    await db.flush()

    # 2. Create ChatAgents
    db_agents: list[ChatAgent] = []
    for i, agent_req in enumerate(request.agents):
        cfg = AgentConfig.from_raw(agent_req.config)
        agent = ChatAgent(
            chat_session_id=session.id,
            name=agent_req.role,
            role=agent_req.role,
            provider=cfg.model.provider or settings.LLM_PROVIDER,
            model=cfg.model.model or settings.LLM_MODEL,
            temperature=cfg.model.temperature if cfg.model.temperature is not None else settings.LLM_TEMPERATURE,
            reasoning_style=cfg.reasoning.style,
            position_order=i,
            is_active=True,
        )
        db.add(agent)
        db_agents.append(agent)
    await db.flush()

    # 3. Create ChatTurn
    turn = ChatTurn(
        chat_session_id=session.id,
        turn_index=1,
        status=ChatTurnStatus.running,
        current_round_no=1,
    )
    db.add(turn)
    await db.flush()

    # 4. Create Round placeholders
    rounds: list[Round] = []
    for rn in range(1, 4):
        r = Round(
            chat_turn_id=turn.id,
            round_number=rn,
            round_type=_ROUND_TYPE_MAP[rn],
            status=RoundStatus.started,
        )
        db.add(r)
        rounds.append(r)
    await db.flush()

    # 5. Run the debate engine
    engine = DebateEngine()
    try:
        result = await engine.run_debate(question=request.question, agents=db_agents)
    except LLMError as exc:
        turn.status = ChatTurnStatus.failed
        await db.flush()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # 6. Persist round outputs as system messages and mark rounds complete
    import json
    for idx, round_obj in enumerate(rounds, start=1):
        key = _ROUND_KEY_MAP[idx]
        content = json.dumps(result[key], ensure_ascii=False)
        msg = Message(
            chat_session_id=session.id,
            chat_turn_id=turn.id,
            round_id=round_obj.id,
            sender_type=SenderType.system,
            message_type=MessageType.system_notice,
            visibility=MessageVisibility.visible,
            content=content,
            sequence_no=idx,
        )
        db.add(msg)
        round_obj.status = RoundStatus.completed

    turn.status = ChatTurnStatus.completed
    turn.current_round_no = 3
    await db.flush()

    return DebateStartResponse(
        debate_id=session.id,
        question=request.question,
        status="completed",
        result=result,
    )


@router.get("/{debate_id}", response_model=DebateResponse)
async def get_debate(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DebateResponse:
    """Return a debate session with its round results."""
    stmt = (
        select(ChatSession)
        .where(ChatSession.id == debate_id)
        .where(ChatSession.user_id == current_user.id)
        .options(
            selectinload(ChatSession.chat_agents),
            selectinload(ChatSession.chat_turns).selectinload(ChatTurn.rounds).selectinload(Round.messages),
        )
    )
    row = await db.execute(stmt)
    session = row.scalar_one_or_none()

    if session is None:
        raise HTTPException(status_code=404, detail=f"Debate {debate_id} not found.")

    import json
    rounds_out = []
    for turn in session.chat_turns:
        for r in sorted(turn.rounds, key=lambda x: x.round_number):
            # Find the system message with the round data
            data = []
            for msg in r.messages:
                if msg.sender_type == SenderType.system:
                    try:
                        data = json.loads(msg.content)
                    except Exception:
                        pass
                    break
            rounds_out.append({
                "id": str(r.id),
                "round_number": r.round_number,
                "data": data,
            })

    return DebateResponse(
        id=session.id,
        question=session.title or "",
        status="completed",
        created_at=session.created_at,
        agents=[
            {"id": str(a.id), "role": a.role, "config": {}}
            for a in session.chat_agents
        ],
        rounds=rounds_out,
    )


router = APIRouter()


@router.post("/start", response_model=DebateStartResponse, status_code=201)
async def start_debate(
    request: DebateStartRequest,
    db: AsyncSession = Depends(get_db),
) -> DebateStartResponse:
    """
    Start a new debate:

    1. Persist a Debate record (status = in_progress).
    2. Persist one Agent record per requested agent.
    3. Run the DebateEngine (Rounds 1-3).
    4. Persist three Round records with the engine output.
    5. Mark the Debate as completed and return the full result.
    """
    # ------------------------------------------------------------------
    # 1. Create and flush the Debate so we get its UUID immediately.
    # ------------------------------------------------------------------
    debate = Debate(question=request.question, status="in_progress")
    db.add(debate)
    await db.flush()

    # ------------------------------------------------------------------
    # 2. Create Agents and flush to obtain their UUIDs before passing
    #    them to the engine (the engine uses agent.id and agent.role).
    # ------------------------------------------------------------------
    db_agents: list[Agent] = []
    for agent_req in request.agents:
        # Merge the typed config back into the raw dict for storage.
        stored_config = agent_req.config.copy()
        if agent_req.parsed_config:
            stored_config["_parsed"] = agent_req.parsed_config.model_dump()
        agent = Agent(
            debate_id=debate.id,
            role=agent_req.role,
            config=stored_config,
        )
        db.add(agent)
        db_agents.append(agent)

    await db.flush()

    # ------------------------------------------------------------------
    # 3. Run the DebateEngine.
    # ------------------------------------------------------------------
    engine = DebateEngine()
    try:
        result = await engine.run_debate(question=request.question, agents=db_agents)
    except LLMError as exc:
        debate.status = "failed"
        await db.flush()
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # ------------------------------------------------------------------
    # 4. Persist one Round record per round.
    # ------------------------------------------------------------------
    for round_number, round_key in enumerate(["round1", "round2", "round3"], start=1):
        round_record = Round(
            debate_id=debate.id,
            round_number=round_number,
            data=result[round_key],
        )
        db.add(round_record)

    # ------------------------------------------------------------------
    # 5. Mark debate complete and let the dependency commit the session.
    # ------------------------------------------------------------------
    debate.status = "completed"
    await db.flush()

    return DebateStartResponse(
        debate_id=debate.id,
        question=debate.question,
        status=debate.status,
        result=result,
    )


@router.get("/{debate_id}", response_model=DebateResponse)
async def get_debate(
    debate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> DebateResponse:
    """
    Return the full debate detail including all agents and rounds.
    Rounds are ordered by round_number (ascending).
    """
    stmt = (
        select(Debate)
        .where(Debate.id == debate_id)
        .options(
            selectinload(Debate.agents),
            selectinload(Debate.rounds),
        )
    )
    row = await db.execute(stmt)
    debate = row.scalar_one_or_none()

    if debate is None:
        raise HTTPException(status_code=404, detail=f"Debate {debate_id} not found.")

    # Sort rounds by round_number for a predictable response order.
    debate.rounds.sort(key=lambda r: r.round_number)

    return debate
