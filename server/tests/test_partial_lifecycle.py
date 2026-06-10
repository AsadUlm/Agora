from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message, MessageType, SenderType
from app.models.user import User
from app.schemas.contracts import AgentRoundResult, ExecutionEvent, ExecutionEventType
from app.services.chat_engine import ChatEngine
from app.services.debate_engine.lifecycle import FinalSynthesisFailed
from app.services.debate_engine.round_manager import RoundManager
from app.services.ws_manager import WebSocketManager


async def _seed_turn(db: AsyncSession) -> ChatTurn:
    user = User(id=uuid.uuid4(), email=f"{uuid.uuid4()}@example.com", password_hash="x")
    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="partial lifecycle")
    agent = ChatAgent(
        id=uuid.uuid4(),
        chat_session_id=session.id,
        name="Analyst",
        role="Analyst",
        provider="mock",
        model="mock",
        temperature=0.2,
        reasoning_style="balanced",
        position_order=0,
    )
    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db.add_all([user, session, agent, turn])
    await db.flush()
    db.add(Message(
        chat_session_id=session.id,
        chat_turn_id=turn.id,
        sender_type=SenderType.user,
        message_type=MessageType.user_input,
        content="Question?",
        sequence_no=0,
    ))
    await db.flush()
    return turn


def _success(stage: int) -> list[AgentRoundResult]:
    return [AgentRoundResult(
        agent_id=uuid.uuid4(),
        role="Analyst",
        content=f"stage {stage}",
        structured={"response": f"stage {stage}"},
        generation_status="success",
    )]


@pytest.mark.asyncio
async def test_final_synthesis_failure_marks_turn_partially_completed(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    turn = await _seed_turn(db_session)
    emitted: list[ExecutionEvent] = []

    async def capture(event: ExecutionEvent) -> None:
        emitted.append(event)

    monkeypatch.setattr(RoundManager, "execute_round_1", lambda self, ctx: _async_result(_success(1)))
    monkeypatch.setattr(RoundManager, "execute_round_2", lambda self, ctx, r1: _async_result(_success(2)))
    monkeypatch.setattr(
        RoundManager,
        "execute_round_critique_response",
        lambda self, ctx, **kwargs: _async_result(_success(3)),
    )
    monkeypatch.setattr(
        RoundManager,
        "execute_round_revised_position",
        lambda self, ctx, **kwargs: _async_result(_success(4)),
    )

    async def fail_final(self, ctx, **kwargs):
        raise FinalSynthesisFailed(
            "Final synthesis failed after agent responses were generated.",
            results=_success(5),
            request_id=str(ctx.turn_id),
        )

    monkeypatch.setattr(RoundManager, "execute_round_final", fail_final)

    await ChatEngine(db_session, on_event=capture).start_turn_execution(turn.id)
    await db_session.refresh(turn)

    assert turn.status == ChatTurnStatus.partially_completed
    assert turn.synthesis_status == "failed"
    assert turn.error_metadata is not None
    assert turn.error_metadata["severity"] == "partial"
    assert turn.error_metadata["phase"] == "final_synthesis"
    assert turn.error_metadata["partial_results_available"] is True
    assert any(e.event_type == ExecutionEventType.turn_partially_completed for e in emitted)
    assert not any(e.event_type == ExecutionEventType.turn_failed for e in emitted)


@pytest.mark.asyncio
async def test_stream_disconnect_does_not_mark_backend_turn_failed(
    db_session: AsyncSession,
) -> None:
    turn = await _seed_turn(db_session)
    turn.status = ChatTurnStatus.running
    await db_session.flush()

    manager = WebSocketManager()
    manager.disconnect_turn(object(), str(turn.id))
    await db_session.refresh(turn)

    assert turn.status == ChatTurnStatus.running


async def _async_result(value):
    return value
