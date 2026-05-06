"""
RoundManager parallel execution tests.

Validates:
- round latency behaves like max(task) instead of sum(task)
- one failed agent does not block others in the same round
- all-agent failure marks the round failed
- message_created events are emitted per-agent before round_completed
"""

from __future__ import annotations

import asyncio
import time
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message
from app.models.round import Round, RoundStatus
from app.models.user import User
from app.schemas.contracts import AgentContext, LLMRequest, LLMResponse, TurnContext
from app.services.debate_engine.round_manager import RoundManager
from app.services.llm import _factory as llm_factory
from app.services.llm.exceptions import LLMError
from app.services.llm.service import LLMService


class _DelayedProvider(LLMService):
    def __init__(self, delay_s: float = 0.25) -> None:
        self._delay_s = delay_s

    async def generate(self, request: LLMRequest) -> LLMResponse:
        await asyncio.sleep(self._delay_s)
        return LLMResponse(
            content='{"stance":"ok","key_points":["a","b"],"confidence":0.7}',
            prompt_tokens=12,
            completion_tokens=18,
            latency_ms=int(self._delay_s * 1000),
        )


class _SelectiveFailProvider(LLMService):
    def __init__(self, fail_roles: set[str], delay_s: float = 0.05) -> None:
        self._fail_roles = fail_roles
        self._delay_s = delay_s

    async def generate(self, request: LLMRequest) -> LLMResponse:
        await asyncio.sleep(self._delay_s)
        for role in self._fail_roles:
            if f"role: {role}" in request.prompt:
                raise LLMError(f"Synthetic failure for {role}")
        return LLMResponse(
            content='{"stance":"ok","key_points":["a"],"confidence":0.5}',
            prompt_tokens=10,
            completion_tokens=16,
            latency_ms=int(self._delay_s * 1000),
        )


async def _seed_turn(db_session: AsyncSession, num_agents: int = 3) -> tuple[TurnContext, list[ChatAgent]]:
    user = User(
        id=uuid.uuid4(),
        email=f"parallel-{uuid.uuid4()}@example.com",
        password_hash="unused",
        name="Parallel Test",
    )
    db_session.add(user)
    await db_session.flush()

    chat_session = ChatSession(
        user_id=user.id,
        title="Parallel test session",
    )
    db_session.add(chat_session)
    await db_session.flush()

    turn = ChatTurn(
        chat_session_id=chat_session.id,
        turn_index=1,
        status=ChatTurnStatus.running,
        execution_mode="auto",
    )
    db_session.add(turn)
    await db_session.flush()

    agents: list[ChatAgent] = []
    for i in range(num_agents):
        agent = ChatAgent(
            chat_session_id=chat_session.id,
            name=f"Agent{i}",
            role=f"Agent{i}",
            provider="mock",
            model="mock-model",
            temperature=0.2,
            reasoning_style="balanced",
            position_order=i,
            is_active=True,
            knowledge_mode="no_docs",
            knowledge_strict=False,
        )
        db_session.add(agent)
        agents.append(agent)

    await db_session.flush()
    await db_session.commit()

    ctx = TurnContext(
        turn_id=turn.id,
        session_id=chat_session.id,
        user_id=user.id,
        question="Should AI be regulated?",
        turn_index=1,
        agents=[
            AgentContext(
                agent_id=a.id,
                role=a.role,
                provider=a.provider,
                model=a.model,
                temperature=float(a.temperature or 0.7),
                reasoning_style=a.reasoning_style or "balanced",
                knowledge_mode=a.knowledge_mode or "shared_session_docs",
                knowledge_strict=bool(a.knowledge_strict),
                assigned_document_ids=[],
            )
            for a in agents
        ],
    )
    return ctx, agents


@pytest.mark.asyncio
async def test_round1_parallel_latency_and_per_agent_emits(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    ctx, _agents = await _seed_turn(db_session, num_agents=3)

    events: list[tuple[str, float]] = []

    async def _on_event(event) -> None:
        events.append((event.event_type.value, time.perf_counter()))

    llm_factory.set_service(_DelayedProvider(delay_s=0.25))
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
            max_concurrent_agent_calls=3,
        )

        started = time.perf_counter()
        results = await manager.execute_round_1(ctx)
        elapsed = time.perf_counter() - started

        assert len(results) == 3
        assert all(r.generation_status == "success" for r in results)
        assert elapsed < 0.65, f"Round took too long for parallel mode: {elapsed:.3f}s"

        message_events = [ts for kind, ts in events if kind == "message_created"]
        round_completed_ts = next(ts for kind, ts in events if kind == "round_completed")

        assert len(message_events) == 3
        assert all(ts < round_completed_ts for ts in message_events)
    finally:
        llm_factory.reset_service()


@pytest.mark.asyncio
async def test_partial_failure_does_not_block_other_agents(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    ctx, agents = await _seed_turn(db_session, num_agents=3)

    llm_factory.set_service(_SelectiveFailProvider(fail_roles={"Agent1"}, delay_s=0.05))
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            session_factory=_test_session_factory,
            max_concurrent_agent_calls=3,
        )
        results = await manager.execute_round_1(ctx)

        failed = [r for r in results if r.generation_status == "failed"]
        succeeded = [r for r in results if r.generation_status == "success"]
        assert len(failed) == 1
        assert failed[0].role == "Agent1"
        assert len(succeeded) == 2

        round_obj = (
            await db_session.execute(
                select(Round).where(
                    Round.chat_turn_id == ctx.turn_id,
                    Round.round_number == 1,
                )
            )
        ).scalar_one()
        assert round_obj.status == RoundStatus.completed

        msgs = (
            await db_session.execute(
                select(Message).where(Message.round_id == round_obj.id)
            )
        ).scalars().all()
        assert len(msgs) == 3

        role_by_id = {a.id: a.role for a in agents}
        agent1_msg = next(m for m in msgs if role_by_id[m.chat_agent_id] == "Agent1")
        assert "error" in (agent1_msg.content or "").lower()
    finally:
        llm_factory.reset_service()


@pytest.mark.asyncio
async def test_all_failed_agents_mark_round_failed(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    ctx, _agents = await _seed_turn(db_session, num_agents=2)

    llm_factory.set_service(_SelectiveFailProvider(fail_roles={"Agent0", "Agent1"}, delay_s=0.01))
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            session_factory=_test_session_factory,
            max_concurrent_agent_calls=2,
        )

        with pytest.raises(RuntimeError, match="All agents failed"):
            await manager.execute_round_1(ctx)

        round_obj = (
            await db_session.execute(
                select(Round).where(
                    Round.chat_turn_id == ctx.turn_id,
                    Round.round_number == 1,
                )
            )
        ).scalar_one()
        assert round_obj.status == RoundStatus.failed
    finally:
        llm_factory.reset_service()
