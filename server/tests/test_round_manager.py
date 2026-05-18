"""
Unit tests for RoundManager — the core debate execution engine.

Tests each round in isolation using the MockProvider (no real LLM calls).
Covers:
  - Round 1: opening statements — correct message types, structured fields
  - Round 2: cross-examination — critiques, single-agent skip case
  - Round 3: final synthesis — final_stance fields
  - Round DB lifecycle: queued → running → completed
  - Sequence numbers: monotonically increasing across rounds
  - Bad LLM output: non-JSON gracefully stored as raw_content
  - LLM errors: generation_status=failed, message still saved
  - on_event: correct event types fired in correct order
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn
from app.models.message import MessageType
from app.models.round import RoundStatus, RoundType
from app.models.user import User
from app.schemas.contracts import (
    AgentContext,
    AgentRoundResult,
    ExecutionEventType,
    LLMRequest,
    LLMResponse,
    TurnContext,
)
from app.services.debate_engine.round_manager import RoundManager
from app.services.llm import _factory as llm_factory
from app.services.llm.exceptions import LLMError
from app.services.llm.providers.mock_provider import MockProvider
from app.services.llm.service import LLMService


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _agent_ctx(**overrides) -> AgentContext:
    defaults = dict(
        agent_id=uuid.uuid4(),
        role="Economist",
        provider="mock",
        model="mock-model",
        temperature=0.7,
    )
    return AgentContext(**{**defaults, **overrides})


def _turn_ctx(session_id: uuid.UUID, turn_id: uuid.UUID, agents: list[AgentContext]) -> TurnContext:
    return TurnContext(
        turn_id=turn_id,
        session_id=session_id,
        user_id=uuid.uuid4(),
        question="Should AI be regulated?",
        agents=agents,
    )


def _r1_result(agent_ctx: AgentContext) -> AgentRoundResult:
    """Minimal round 1 result for seeding round 2 / round 3 inputs."""
    return AgentRoundResult(
        agent_id=agent_ctx.agent_id,
        role=agent_ctx.role,
        content=json.dumps({"stance": f"{agent_ctx.role} stance", "key_points": ["p1"], "confidence": 0.8}),
        structured={"stance": f"{agent_ctx.role} stance", "key_points": ["p1"], "confidence": 0.8},
    )


# ─────────────────────────────────────────────────────────────────────────────
# DB fixtures — seed the minimum rows needed to satisfy FK constraints
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture()
async def db_context(db_session: AsyncSession):
    """Seed User → ChatSession → ChatTurn and return (session_id, turn_id, db)."""
    user = User(id=uuid.uuid4(), email="rm_test@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()

    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="test")
    db_session.add(session)
    await db_session.flush()

    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db_session.add(turn)
    await db_session.flush()

    return session.id, turn.id, db_session


@pytest.fixture(autouse=True)
def _use_mock_llm():
    """Ensure MockProvider is active for every test in this module."""
    llm_factory.set_service(MockProvider())
    yield
    llm_factory.reset_service()


# ─────────────────────────────────────────────────────────────────────────────
# Round 1 — Opening Statements
# ─────────────────────────────────────────────────────────────────────────────

class TestRound1:
    async def test_returns_one_result_per_agent(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist")]
        ctx = _turn_ctx(session_id, turn_id, agents)

        rm = RoundManager(db)
        results = await rm.execute_round_1(ctx)

        assert len(results) == 2

    async def test_results_have_stance_and_key_points(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx()]
        ctx = _turn_ctx(session_id, turn_id, agents)

        rm = RoundManager(db)
        results = await rm.execute_round_1(ctx)

        assert "stance" in results[0].structured
        assert "key_points" in results[0].structured
        assert "confidence" in results[0].structured

    async def test_messages_saved_with_agent_response_type(self, db_context):
        from sqlalchemy import select
        from app.models.message import Message

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Scientist")]
        ctx = _turn_ctx(session_id, turn_id, agents)

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        msgs = (await db.execute(select(Message).where(Message.chat_turn_id == turn_id))).scalars().all()
        assert len(msgs) == 2
        assert all(m.message_type == MessageType.agent_response for m in msgs)

    async def test_generation_status_is_success(self, db_context):
        session_id, turn_id, db = db_context
        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])

        rm = RoundManager(db)
        results = await rm.execute_round_1(ctx)

        assert results[0].generation_status == "success"

    async def test_round_record_completed(self, db_context):
        from sqlalchemy import select
        from app.models.round import Round

        session_id, turn_id, db = db_context
        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        rounds = (await db.execute(select(Round).where(Round.chat_turn_id == turn_id))).scalars().all()
        assert len(rounds) == 1
        assert rounds[0].round_number == 1
        assert rounds[0].round_type == RoundType.initial
        assert rounds[0].status == RoundStatus.completed
        assert rounds[0].started_at is not None
        assert rounds[0].ended_at is not None


# ─────────────────────────────────────────────────────────────────────────────
# Round 2 — Cross Examination
# ─────────────────────────────────────────────────────────────────────────────

class TestRound2:
    async def test_returns_one_result_per_agent(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        results = await rm.execute_round_2(ctx, r1)

        assert len(results) == 2

    async def test_messages_saved_with_critique_type(self, db_context):
        from sqlalchemy import select
        from app.models.message import Message

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_2(ctx, r1)

        msgs = (await db.execute(select(Message).where(Message.chat_turn_id == turn_id))).scalars().all()
        assert all(m.message_type == MessageType.critique for m in msgs)

    async def test_single_agent_skipped(self, db_context):
        session_id, turn_id, db = db_context
        agent = _agent_ctx()
        ctx = _turn_ctx(session_id, turn_id, [agent])
        r1 = [_r1_result(agent)]

        rm = RoundManager(db)
        results = await rm.execute_round_2(ctx, r1)

        assert results[0].generation_status == "skipped"
        assert results[0].structured.get("critiques") == []

    async def test_round_record_is_critique_type(self, db_context):
        from sqlalchemy import select
        from app.models.round import Round

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(), _agent_ctx()]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_2(ctx, r1)

        rounds = (await db.execute(select(Round).where(Round.chat_turn_id == turn_id))).scalars().all()
        assert rounds[0].round_type == RoundType.critique
        assert rounds[0].status == RoundStatus.completed


# ─────────────────────────────────────────────────────────────────────────────
# Round 3 — Final Synthesis
# ─────────────────────────────────────────────────────────────────────────────

class TestRound3:
    async def test_returns_one_result_per_agent(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]  # reuse shape; round 3 only reads critiques

        rm = RoundManager(db)
        results = await rm.execute_round_3(ctx, r1, r2)

        assert len(results) == 2

    async def test_results_have_final_stance(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx()]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        results = await rm.execute_round_3(ctx, r1, r2)

        assert "final_stance" in results[0].structured
        assert "what_changed" in results[0].structured
        assert "recommendation" in results[0].structured

    async def test_messages_saved_with_final_summary_type(self, db_context):
        from sqlalchemy import select
        from app.models.message import Message

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Scientist")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_3(ctx, r1, r2)

        msgs = (await db.execute(select(Message).where(Message.chat_turn_id == turn_id))).scalars().all()
        assert all(m.message_type == MessageType.final_summary for m in msgs)

    async def test_round_record_is_final_type(self, db_context):
        from sqlalchemy import select
        from app.models.round import Round

        session_id, turn_id, db = db_context
        agents = [_agent_ctx()]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_3(ctx, r1, r2)

        rounds = (await db.execute(select(Round).where(Round.chat_turn_id == turn_id))).scalars().all()
        assert rounds[0].round_type == RoundType.final
        assert rounds[0].status == RoundStatus.completed


# ─────────────────────────────────────────────────────────────────────────────
# Sequence numbers
# ─────────────────────────────────────────────────────────────────────────────

class TestSequenceNumbers:
    async def test_messages_have_unique_monotonic_sequence_numbers(self, db_context):
        from sqlalchemy import select
        from app.models.message import Message

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="A"), _agent_ctx(role="B")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)
        await rm.execute_round_2(ctx, r1)
        await rm.execute_round_3(ctx, r1, r2)

        msgs = (await db.execute(
            select(Message).where(Message.chat_turn_id == turn_id).order_by(Message.sequence_no)
        )).scalars().all()

        seq_nos = [m.sequence_no for m in msgs]
        assert seq_nos == list(range(len(seq_nos))), f"Sequence numbers not monotonic: {seq_nos}"


# ─────────────────────────────────────────────────────────────────────────────
# Bad LLM output
# ─────────────────────────────────────────────────────────────────────────────

class _PlainTextProvider(LLMService):
    """Returns plain text instead of JSON."""
    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(content="This is not JSON at all.", prompt_tokens=5, completion_tokens=10, latency_ms=1)


class _ErrorProvider(LLMService):
    """Always raises LLMError."""
    async def generate(self, request: LLMRequest) -> LLMResponse:
        raise LLMError("upstream timeout")


class _CapturingProvider(LLMService):
    """Records every prompt it receives; returns valid mock JSON."""
    def __init__(self):
        self.prompts: list[str] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.prompts.append(request.prompt)
        import json
        from app.services.llm.providers.mock_provider import _MOCK_STRUCTURED
        return LLMResponse(content=json.dumps(_MOCK_STRUCTURED), prompt_tokens=5, completion_tokens=20, latency_ms=1)


# ─────────────────────────────────────────────────────────────────────────────
# Round 2 multi-agent pairing
# ─────────────────────────────────────────────────────────────────────────────

class TestRound2Pairing:
    async def test_three_agents_each_see_two_opponents_in_prompt(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist"), _agent_ctx(role="Engineer")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        capturing = _CapturingProvider()
        llm_factory.set_service(capturing)

        rm = RoundManager(db)
        await rm.execute_round_2(ctx, r1)

        # 3 agents → 3 prompts, each should mention exactly 2 opponents
        assert len(capturing.prompts) == 3
        for prompt in capturing.prompts:
            opponent_count = prompt.count("Opponent ")
            assert opponent_count == 2, f"Expected 2 opponents in prompt, got {opponent_count}"

    async def test_four_agents_each_see_three_opponents_in_prompt(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role=r) for r in ["Economist", "Ethicist", "Engineer", "Scientist"]]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        capturing = _CapturingProvider()
        llm_factory.set_service(capturing)

        rm = RoundManager(db)
        await rm.execute_round_2(ctx, r1)

        assert len(capturing.prompts) == 4
        for prompt in capturing.prompts:
            opponent_count = prompt.count("Opponent ")
            assert opponent_count == 3, f"Expected 3 opponents in prompt, got {opponent_count}"

    async def test_each_agent_does_not_see_itself_as_opponent(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="Economist"), _agent_ctx(role="Ethicist"), _agent_ctx(role="Engineer")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]

        capturing = _CapturingProvider()
        llm_factory.set_service(capturing)

        rm = RoundManager(db)
        results = await rm.execute_round_2(ctx, r1)

        # Each prompt should not contain the agent's own role as an opponent
        for i, prompt in enumerate(capturing.prompts):
            own_role = agents[i].role
            # The agent's own role appears in "Your own opening stance" but not as "Opponent X — <own_role>"
            assert f"Opponent" not in prompt.split(f"Your own opening stance")[0] or \
                   f"— {own_role}" not in prompt.split("Opponent")[1] if "Opponent" in prompt else True


# ─────────────────────────────────────────────────────────────────────────────
# LLMCall DB records
# ─────────────────────────────────────────────────────────────────────────────

class TestLLMCallRecords:
    async def test_one_llm_call_row_per_agent_per_round(self, db_context):
        from sqlalchemy import select
        from app.models.llm_call import LLMCall

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="A"), _agent_ctx(role="B")]
        ctx = _turn_ctx(session_id, turn_id, agents)

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        calls = (await db.execute(select(LLMCall).where(LLMCall.chat_turn_id == turn_id))).scalars().all()
        assert len(calls) == 2  # one per agent

    async def test_llm_call_has_correct_provider_and_model(self, db_context):
        from sqlalchemy import select
        from app.models.llm_call import LLMCall

        session_id, turn_id, db = db_context
        agent = _agent_ctx(provider="mock", model="mock-model")
        ctx = _turn_ctx(session_id, turn_id, [agent])

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        calls = (await db.execute(select(LLMCall).where(LLMCall.chat_turn_id == turn_id))).scalars().all()
        assert calls[0].provider == "mock"
        assert calls[0].model == "mock-model"

    async def test_llm_call_status_completed_on_success(self, db_context):
        from sqlalchemy import select
        from app.models.llm_call import LLMCall, LLMCallStatus

        session_id, turn_id, db = db_context
        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        calls = (await db.execute(select(LLMCall).where(LLMCall.chat_turn_id == turn_id))).scalars().all()
        assert calls[0].status == LLMCallStatus.completed
        assert calls[0].ended_at is not None

    async def test_llm_call_status_failed_on_error(self, db_context):
        from sqlalchemy import select
        from app.models.llm_call import LLMCall, LLMCallStatus

        session_id, turn_id, db = db_context
        llm_factory.set_service(_ErrorProvider())

        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])
        rm = RoundManager(db)
        await rm.execute_round_1(ctx)

        calls = (await db.execute(select(LLMCall).where(LLMCall.chat_turn_id == turn_id))).scalars().all()
        assert calls[0].status == LLMCallStatus.failed
        assert calls[0].ended_at is not None

    async def test_six_llm_call_rows_for_two_agents_three_rounds(self, db_context):
        from sqlalchemy import select
        from app.models.llm_call import LLMCall

        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="A"), _agent_ctx(role="B")]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        rm = RoundManager(db)
        await rm.execute_round_1(ctx)
        await rm.execute_round_2(ctx, r1)
        await rm.execute_round_3(ctx, r1, r2)

        calls = (await db.execute(select(LLMCall).where(LLMCall.chat_turn_id == turn_id))).scalars().all()
        assert len(calls) == 6  # 2 agents × 3 rounds


class TestBadLLMOutput:
    async def test_non_json_response_stored_as_raw_content(self, db_context):
        session_id, turn_id, db = db_context
        llm_factory.set_service(_PlainTextProvider())

        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])
        rm = RoundManager(db)
        results = await rm.execute_round_1(ctx)

        assert results[0].generation_status == "success"
        assert "raw_content" in results[0].structured

    async def test_llm_error_marks_failed_but_saves_message(self, db_context):
        from sqlalchemy import select
        from app.models.message import Message

        session_id, turn_id, db = db_context
        llm_factory.set_service(_ErrorProvider())

        ctx = _turn_ctx(session_id, turn_id, [_agent_ctx()])
        rm = RoundManager(db)
        results = await rm.execute_round_1(ctx)

        assert results[0].generation_status == "failed"
        assert results[0].error is not None

        msgs = (await db.execute(select(Message).where(Message.chat_turn_id == turn_id))).scalars().all()
        assert len(msgs) == 1  # message still saved even on failure


# ─────────────────────────────────────────────────────────────────────────────
# on_event callback
# ─────────────────────────────────────────────────────────────────────────────

class TestOnEvent:
    async def test_round1_fires_round_started_messages_and_completed(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx(role="A"), _agent_ctx(role="B")]
        ctx = _turn_ctx(session_id, turn_id, agents)

        fired: list[str] = []

        async def capture(event):
            fired.append(event.event_type.value)

        rm = RoundManager(db, on_event=capture)
        await rm.execute_round_1(ctx)

        assert fired[0] == ExecutionEventType.round_started
        assert fired.count(ExecutionEventType.message_created) == 2
        assert fired[-1] == ExecutionEventType.round_completed

    async def test_all_three_rounds_fire_started_and_completed(self, db_context):
        session_id, turn_id, db = db_context
        agents = [_agent_ctx()]
        ctx = _turn_ctx(session_id, turn_id, agents)
        r1 = [_r1_result(a) for a in agents]
        r2 = [_r1_result(a) for a in agents]

        started: list[int] = []
        completed: list[int] = []

        async def capture(event):
            if event.event_type == ExecutionEventType.round_started:
                started.append(event.round_number)
            elif event.event_type == ExecutionEventType.round_completed:
                completed.append(event.round_number)

        rm = RoundManager(db, on_event=capture)
        await rm.execute_round_1(ctx)
        await rm.execute_round_2(ctx, r1)
        await rm.execute_round_3(ctx, r1, r2)

        assert started == [1, 2, 3]
        assert completed == [1, 2, 3]
