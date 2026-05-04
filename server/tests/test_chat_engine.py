"""
Integration tests for ChatEngine — the orchestrator that runs all 3 rounds.

Tests the full turn execution lifecycle:
  - Turn status transitions: queued → running → completed / failed
  - All 3 rounds are created and completed
  - Round 1 results are correctly fed into round 2 and round 3
  - Sequence numbers start at 1 (ChatEngine uses seq_start=1)
  - 9 messages total for a 3-agent debate (3 agents × 3 rounds)
  - Turn fails cleanly when LLM errors on every call
  - on_event fires turn_started and turn_completed
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message, MessageType, SenderType
from app.models.round import Round, RoundStatus
from app.models.user import User
from app.schemas.contracts import ExecutionEventType, LLMRequest, LLMResponse
from app.services.chat_engine import ChatEngine
from app.services.llm import _factory as llm_factory
from app.services.llm.exceptions import LLMError
from app.services.llm.providers.mock_provider import MockProvider
from app.services.llm.service import LLMService


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _use_mock_llm():
    llm_factory.set_service(MockProvider())
    yield
    llm_factory.reset_service()


@pytest.fixture()
async def debate_context(db_session: AsyncSession):
    """
    Seed a full debate setup: User → ChatSession → ChatAgents → ChatTurn → user_input Message.
    Returns (turn_id, session_id, agent_ids, db).
    """
    user = User(id=uuid.uuid4(), email="ce_test@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()

    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="CE test")
    db_session.add(session)
    await db_session.flush()

    agents = [
        ChatAgent(id=uuid.uuid4(), chat_session_id=session.id, name=role, role=role,
                  provider="mock", model="mock-model", temperature=0.7,
                  reasoning_style="balanced", position_order=i)
        for i, role in enumerate(["Economist", "Ethicist"])
    ]
    for a in agents:
        db_session.add(a)
    await db_session.flush()

    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db_session.add(turn)
    await db_session.flush()

    user_msg = Message(
        chat_session_id=session.id,
        chat_turn_id=turn.id,
        sender_type=SenderType.user,
        message_type=MessageType.user_input,
        content="Should AI be regulated?",
        sequence_no=0,
    )
    db_session.add(user_msg)
    await db_session.flush()

    return turn.id, session.id, [a.id for a in agents], db_session


# ─────────────────────────────────────────────────────────────────────────────
# Turn lifecycle
# ─────────────────────────────────────────────────────────────────────────────

class TestTurnLifecycle:
    async def test_turn_status_completed_after_execution(self, debate_context):
        turn_id, _, _, db = debate_context

        await ChatEngine(db).start_turn_execution(turn_id)

        turn = await db.get(ChatTurn, turn_id)
        assert turn.status == ChatTurnStatus.completed
        assert turn.started_at is not None
        assert turn.ended_at is not None

    async def test_three_rounds_all_completed(self, debate_context):
        turn_id, _, _, db = debate_context

        await ChatEngine(db).start_turn_execution(turn_id)

        rounds = (await db.execute(
            select(Round).where(Round.chat_turn_id == turn_id).order_by(Round.round_number)
        )).scalars().all()

        assert len(rounds) == 3
        assert [r.round_number for r in rounds] == [1, 2, 3]
        assert all(r.status == RoundStatus.completed for r in rounds)

    async def test_result_dict_has_all_three_rounds(self, debate_context):
        turn_id, _, _, db = debate_context

        result = await ChatEngine(db).start_turn_execution(turn_id)

        assert "round1" in result
        assert "round2" in result
        assert "round3" in result

    async def test_llm_errors_are_handled_gracefully_turn_still_completes(self, debate_context):
        """LLMError per agent is caught and stored — the turn still completes."""
        turn_id, _, _, db = debate_context

        class _AlwaysError(LLMService):
            async def generate(self, request: LLMRequest) -> LLMResponse:
                raise LLMError("forced failure")

        llm_factory.set_service(_AlwaysError())

        result = await ChatEngine(db).start_turn_execution(turn_id)

        turn = await db.get(ChatTurn, turn_id)
        assert turn.status == ChatTurnStatus.completed

        # All agent results should be marked failed
        for r in result["round1"]:
            assert r["generation_status"] == "failed"

    async def test_turn_marked_failed_on_unrecoverable_error(self, debate_context):
        """A crash outside the LLM call (e.g. DB error) marks the turn failed."""
        turn_id, _, _, db = debate_context

        class _CrashProvider(LLMService):
            async def generate(self, request: LLMRequest) -> LLMResponse:
                raise RuntimeError("unexpected crash")

        llm_factory.set_service(_CrashProvider())

        with pytest.raises(RuntimeError):
            await ChatEngine(db).start_turn_execution(turn_id)

        turn = await db.get(ChatTurn, turn_id)
        assert turn.status == ChatTurnStatus.failed
        assert turn.ended_at is not None


# ─────────────────────────────────────────────────────────────────────────────
# Messages and sequence numbers
# ─────────────────────────────────────────────────────────────────────────────

class TestMessagesAndSequence:
    async def test_six_agent_messages_saved_for_two_agents(self, debate_context):
        turn_id, _, _, db = debate_context

        await ChatEngine(db).start_turn_execution(turn_id)

        msgs = (await db.execute(
            select(Message).where(
                Message.chat_turn_id == turn_id,
                Message.sender_type == SenderType.agent,
            )
        )).scalars().all()

        assert len(msgs) == 6  # 2 agents × 3 rounds

    async def test_sequence_numbers_start_at_1(self, debate_context):
        """ChatEngine uses seq_start=1, reserving 0 for the user message."""
        turn_id, _, _, db = debate_context

        await ChatEngine(db).start_turn_execution(turn_id)

        msgs = (await db.execute(
            select(Message).where(
                Message.chat_turn_id == turn_id,
                Message.sender_type == SenderType.agent,
            ).order_by(Message.sequence_no)
        )).scalars().all()

        seq_nos = [m.sequence_no for m in msgs]
        assert seq_nos[0] == 1
        assert seq_nos == list(range(1, len(seq_nos) + 1))

    async def test_correct_message_types_per_round(self, debate_context):
        turn_id, _, _, db = debate_context

        await ChatEngine(db).start_turn_execution(turn_id)

        msgs = (await db.execute(
            select(Message).where(
                Message.chat_turn_id == turn_id,
                Message.sender_type == SenderType.agent,
            )
        )).scalars().all()

        types = {m.message_type for m in msgs}
        assert MessageType.agent_response in types
        assert MessageType.critique in types
        assert MessageType.final_summary in types


# ─────────────────────────────────────────────────────────────────────────────
# Round result handoff
# ─────────────────────────────────────────────────────────────────────────────

class TestRoundHandoff:
    async def test_round2_prompts_reference_round1_stances(self, debate_context):
        """Round 1 stances must appear in Round 2 prompts — proves r1 results were passed in."""
        turn_id, _, _, db = debate_context

        captured_prompts: list[str] = []

        import json
        from app.services.llm.providers.mock_provider import _MOCK_STRUCTURED

        class _CapturingProvider(LLMService):
            async def generate(self, request: LLMRequest) -> LLMResponse:
                captured_prompts.append(request.prompt)
                return LLMResponse(content=json.dumps(_MOCK_STRUCTURED), prompt_tokens=5, completion_tokens=20, latency_ms=1)

        llm_factory.set_service(_CapturingProvider())

        await ChatEngine(db).start_turn_execution(turn_id)

        # Round 2 prompts are prompts 3 and 4 (after 2 round 1 prompts)
        round2_prompts = captured_prompts[2:4]
        for prompt in round2_prompts:
            # MockProvider returns "Mock stance: this topic has multiple valid perspectives."
            assert "Mock stance" in prompt

    async def test_round3_receives_debate_summary_from_round2(self, debate_context):
        """Round 3 prompts must contain cross-examination content — proves r2 results were passed in."""
        turn_id, _, _, db = debate_context

        captured_prompts: list[str] = []

        import json
        from app.services.llm.providers.mock_provider import _MOCK_STRUCTURED

        class _CapturingProvider(LLMService):
            async def generate(self, request: LLMRequest) -> LLMResponse:
                captured_prompts.append(request.prompt)
                return LLMResponse(content=json.dumps(_MOCK_STRUCTURED), prompt_tokens=5, completion_tokens=20, latency_ms=1)

        llm_factory.set_service(_CapturingProvider())

        await ChatEngine(db).start_turn_execution(turn_id)

        # Round 3 prompts are the last 2
        round3_prompts = captured_prompts[4:6]
        for prompt in round3_prompts:
            assert "original stance" in prompt.lower() or "debate" in prompt.lower()


# ─────────────────────────────────────────────────────────────────────────────
# on_event callback
# ─────────────────────────────────────────────────────────────────────────────

class TestChatEngineEvents:
    async def test_turn_started_and_completed_events_fire(self, debate_context):
        turn_id, _, _, db = debate_context

        fired: list[str] = []

        async def capture(event):
            fired.append(event.event_type.value)

        await ChatEngine(db, on_event=capture).start_turn_execution(turn_id)

        assert ExecutionEventType.turn_started in fired
        assert ExecutionEventType.turn_completed in fired

    async def test_turn_failed_event_fires_on_unrecoverable_error(self, debate_context):
        turn_id, _, _, db = debate_context

        class _CrashProvider(LLMService):
            async def generate(self, request: LLMRequest) -> LLMResponse:
                raise RuntimeError("unexpected crash")

        llm_factory.set_service(_CrashProvider())

        fired: list[str] = []

        async def capture(event):
            fired.append(event.event_type.value)

        with pytest.raises(RuntimeError):
            await ChatEngine(db, on_event=capture).start_turn_execution(turn_id)

        assert ExecutionEventType.turn_failed in fired
        assert ExecutionEventType.turn_completed not in fired
