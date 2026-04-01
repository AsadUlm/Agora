"""
Debate API routes.

POST /debates/start  — Start a new debate (creates DB records + runs engine).
GET  /debates/{id}   — Retrieve a full debate with all agents and rounds.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.agent import Agent
from app.models.debate import Debate
from app.models.round import Round
from app.schemas.debate import DebateResponse, DebateStartRequest, DebateStartResponse
from app.services.debate_engine.engine import DebateEngine
from app.services.llm.exceptions import LLMError

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
