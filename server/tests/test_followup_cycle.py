"""End-to-end regression tests for the follow-up debate cycle.

Guards the fix for the bug where asking a follow-up after a completed debate
crashed the whole cycle with ``RuntimeError: All agents failed in follow-up
response``. Root cause: ``followup_response`` rounds were validated against
round-1 required fields (which demand a ``stance`` the follow-up schema does
not produce), so every follow-up answer was wrongly flagged
``missing_required_fields`` and failed.

These tests mirror the exact frontend flow:
  1. POST /debates/start            → initial 3-round debate completes
  2. POST /debates/{id}/follow-ups  → follow-up cycle runs in the background
  3. GET  /debates/{id}             → result must render and every round
                                      must be ``completed`` (never stuck
                                      ``running`` from the streaming-overlap
                                      session race).
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import delete, select, update

from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message
from app.models.round import Round, RoundStatus, RoundType
from app.services.debate_engine.round_manager import RoundManager
from app.services.followup_runner import reconcile_followup_status
from app.services.llm.provider_error_classifier import FOLLOWUP_PARTIAL_COMPLETION

INITIAL_Q = (
    "Should governments impose strict regulations on high-risk AI applications, "
    "or would such rules slow innovation and strengthen large technology companies?"
)
FOLLOW_UP_Q = (
    "How can regulation avoid giving large technology companies an unfair advantage?"
)
FOLLOW_UP_Q2 = "Which agent changed its position the most and why?"


async def _start_completed_debate(client: AsyncClient) -> str:
    start = await client.post(
        "/debates/start",
        json={
            "question": INITIAL_Q,
            "agents": [{"role": "Analyst"}, {"role": "Critic"}],
            "execution_mode": "auto",
        },
    )
    assert start.status_code == 201, start.text
    debate_id = start.json()["debate_id"]
    detail = (await client.get(f"/debates/{debate_id}")).json()
    assert detail["latest_turn"]["status"] == "completed"
    return debate_id


def _assert_all_rounds_completed(rounds: list[dict]) -> None:
    for r in rounds:
        assert r["status"] == "completed", (
            f"Round {r['round_number']} ({r['round_type']}) is {r['status']}"
        )


async def test_followup_completes_without_documents(client: AsyncClient):
    """Test 1/2 — a follow-up (no RAG documents) completes end-to-end."""
    debate_id = await _start_completed_debate(client)

    fu = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    assert fu.status_code == 201, fu.text
    body = fu.json()
    assert body["cycle_number"] == 2
    assert body["turn_id"]

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    assert turn["status"] == "completed", f"Follow-up turn ended as {turn['status']}"
    assert len(turn.get("follow_ups", [])) == 1

    rounds = turn["rounds"]
    # Cycle 1 (rounds 1-5) + cycle 2 follow-up (rounds 6-10).
    assert len(rounds) == 10
    _assert_all_rounds_completed(rounds)

    cycle2 = [r for r in rounds if r.get("cycle_number") == 2]
    types = {r["round_type"] for r in cycle2}
    assert types == {
        "followup_response",
        "followup_cross_critique",
        "followup_response_to_critique",
        "followup_revised_position",
        "updated_synthesis",
    }
    # The follow-up response round must carry rendered messages, not be empty.
    resp_round = next(r for r in cycle2 if r["round_type"] == "followup_response")
    assert len(resp_round["messages"]) >= 1
    critique_round = next(r for r in cycle2 if r["round_type"] == "followup_cross_critique")
    assert len(critique_round["messages"]) >= 1
    synthesis_round = next(r for r in cycle2 if r["round_type"] == "updated_synthesis")
    assert synthesis_round["cycle_number"] == 2
    assert len(synthesis_round["messages"]) >= 1
    assert turn["current_stage"] == synthesis_round["round_number"]
    assert turn["synthesis_status"] == "completed"
    assert turn["error"] is None


async def test_multiple_followups_preserve_history(client: AsyncClient):
    """Test 4 — two sequential follow-ups keep history and add new cycles."""
    debate_id = await _start_completed_debate(client)

    fu1 = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    assert fu1.status_code == 201, fu1.text

    fu2 = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q2}
    )
    assert fu2.status_code == 201, fu2.text

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    assert turn["status"] == "completed"
    assert len(turn.get("follow_ups", [])) == 2

    rounds = turn["rounds"]
    # 3 cycles × 5 rounds = 15 rounds.
    assert len(rounds) == 15, f"Expected 15 rounds, got {len(rounds)}"
    _assert_all_rounds_completed(rounds)
    assert {r.get("cycle_number") for r in rounds} == {1, 2, 3}


async def test_followup_language_inherits_then_overrides(client: AsyncClient):
    start = await client.post(
        "/debates/start",
        json={
            "question": "Должны ли правительства строго регулировать высокорисковые AI-системы?",
            "agents": [{"role": "Analyst"}, {"role": "Critic"}],
            "execution_mode": "auto",
        },
    )
    assert start.status_code == 201, start.text
    assert start.json()["response_language_code"] == "ru"
    debate_id = start.json()["debate_id"]

    inherited = await client.post(
        f"/debates/{debate_id}/follow-ups",
        json={"question": "why?"},
    )
    assert inherited.status_code == 201, inherited.text
    assert inherited.json()["response_language_code"] == "ru"
    assert inherited.json()["response_language_source"] == "inherited"

    overridden = await client.post(
        f"/debates/{debate_id}/follow-ups",
        json={"question": "그럼 스타트업에는 어떤 영향이 있나요?"},
    )
    assert overridden.status_code == 201, overridden.text
    assert overridden.json()["response_language_code"] == "ko"

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    assert turn["response_language_code"] == "ru"
    assert turn["response_language_name"] == "Russian"
    assert turn["follow_ups"][0]["response_language_code"] == "ru"
    assert turn["follow_ups"][0]["response_language_source"] == "inherited"
    assert turn["follow_ups"][1]["response_language_code"] == "ko"


async def test_followup_on_empty_question_rejected(client: AsyncClient):
    """An empty follow-up question is rejected before any background work."""
    debate_id = await _start_completed_debate(client)
    resp = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": "   "}
    )
    assert resp.status_code == 422


async def test_followup_on_missing_debate_returns_404(client: AsyncClient):
    """A follow-up against an unknown debate id returns a clean 404."""
    resp = await client.post(
        "/debates/00000000-0000-0000-0000-0000000000ff/follow-ups",
        json={"question": FOLLOW_UP_Q},
    )
    assert resp.status_code == 404


async def test_followup_reconcile_marks_partial_when_synthesis_missing(
    client: AsyncClient,
    db_session,
    _test_session_factory,
):
    """Persisted responses without synthesis terminally reconcile as partial."""
    debate_id = await _start_completed_debate(client)
    await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    detail = (await client.get(f"/debates/{debate_id}")).json()
    turn_id = uuid.UUID(detail["latest_turn"]["id"])
    synthesis_round_id = uuid.UUID(next(
        r["id"]
        for r in detail["latest_turn"]["rounds"]
        if r.get("cycle_number") == 2 and r["round_type"] == "updated_synthesis"
    ))

    await db_session.execute(delete(Message).where(Message.round_id == synthesis_round_id))
    await db_session.execute(delete(Round).where(Round.id == synthesis_round_id))
    await db_session.execute(
        update(ChatTurn)
        .where(ChatTurn.id == turn_id)
        .values(status=ChatTurnStatus.running, ended_at=None, synthesis_status="running")
    )
    await db_session.commit()

    outcome = await reconcile_followup_status(
        turn_id=turn_id,
        cycle_number=2,
        session_factory=_test_session_factory,
    )
    assert outcome.status == ChatTurnStatus.partially_completed
    assert outcome.response_count >= 1
    assert outcome.synthesis_count == 0
    assert "updated_synthesis" in outcome.missing_stages

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    assert turn["status"] == "partially_completed"
    assert turn["synthesis_status"] == "failed"
    assert turn["error"]["partial_results_available"] is True
    assert all(
        round_["status"] not in {"queued", "running"}
        for round_ in turn["rounds"]
        if round_.get("cycle_number") == 2
    )


async def test_followup_reconcile_closes_stale_running_round(
    client: AsyncClient,
    db_session,
    _test_session_factory,
):
    """A background exit cannot leave the turn or a cycle round running."""
    debate_id = await _start_completed_debate(client)
    await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    detail = (await client.get(f"/debates/{debate_id}")).json()
    turn_id = uuid.UUID(detail["latest_turn"]["id"])
    critique_round_id = uuid.UUID(next(
        r["id"]
        for r in detail["latest_turn"]["rounds"]
        if r.get("cycle_number") == 2 and r["round_type"] == "followup_cross_critique"
    ))

    await db_session.execute(
        update(Round)
        .where(Round.id == critique_round_id)
        .values(status=RoundStatus.running, ended_at=None)
    )
    await db_session.execute(
        update(ChatTurn)
        .where(ChatTurn.id == turn_id)
        .values(status=ChatTurnStatus.running, ended_at=None)
    )
    await db_session.commit()

    outcome = await reconcile_followup_status(
        turn_id=turn_id,
        cycle_number=2,
        session_factory=_test_session_factory,
    )
    assert outcome.status == ChatTurnStatus.partially_completed

    persisted = await db_session.execute(
        select(ChatTurn, Round)
        .join(Round, Round.chat_turn_id == ChatTurn.id)
        .where(ChatTurn.id == turn_id, Round.id == critique_round_id)
    )
    turn, round_ = persisted.one()
    assert turn.status == ChatTurnStatus.partially_completed
    assert round_.status == RoundStatus.partially_completed
    assert turn.status != ChatTurnStatus.running
    assert round_.status != RoundStatus.running


async def test_followup_compact_pipeline_generates_updated_synthesis(
    client: AsyncClient,
    monkeypatch,
):
    """Critique unavailability degrades the cycle but does not block synthesis."""

    async def _fail_critique(*_args, **_kwargs):
        raise RuntimeError("simulated follow-up critique outage")

    monkeypatch.setattr(RoundManager, "execute_followup_critique", _fail_critique)

    debate_id = await _start_completed_debate(client)
    response = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    assert response.status_code == 201, response.text

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    cycle2 = [r for r in turn["rounds"] if r.get("cycle_number") == 2]
    synthesis = next(r for r in cycle2 if r["round_type"] == "updated_synthesis")

    assert turn["status"] == "partially_completed"
    assert turn["synthesis_status"] == "completed"
    assert turn["error"]["code"] == FOLLOWUP_PARTIAL_COMPLETION
    assert "NOT NULL constraint failed" not in turn["error"]["message"]
    assert synthesis["status"] == "completed"
    assert len(synthesis["messages"]) >= 1
    assert all(r["status"] not in {"queued", "running"} for r in cycle2)


async def test_followup_recovers_poisoned_session_and_generates_synthesis(
    client: AsyncClient,
    monkeypatch,
):
    """A failed optional-stage flush cannot block the required synthesis."""

    async def _poison_critique_session(self, ctx, **kwargs):
        self.db.add(
            Round(
                chat_turn_id=None,
                round_number=kwargs["round_number"],
                cycle_number=kwargs["cycle_number"],
                round_type=RoundType.followup_cross_critique,
                status=RoundStatus.queued,
            )
        )
        await self.db.flush()

    monkeypatch.setattr(
        RoundManager,
        "execute_followup_critique",
        _poison_critique_session,
    )

    debate_id = await _start_completed_debate(client)
    response = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    assert response.status_code == 201, response.text

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    cycle2 = [r for r in turn["rounds"] if r.get("cycle_number") == 2]
    synthesis = next(r for r in cycle2 if r["round_type"] == "updated_synthesis")

    assert turn["status"] == "partially_completed"
    assert turn["synthesis_status"] == "completed"
    assert turn["error"]["code"] == FOLLOWUP_PARTIAL_COMPLETION
    assert "NOT NULL constraint failed" not in turn["error"]["message"]
    assert synthesis["status"] == "completed"
    assert len(synthesis["messages"]) >= 1
    assert all(r["status"] not in {"queued", "running"} for r in cycle2)


async def test_followup_failure_emits_safe_error_and_terminal_status(
    client: AsyncClient,
    monkeypatch,
):
    """An outer runner failure is persisted instead of leaving the turn queued."""

    async def _fail_memory(*_args, **_kwargs):
        raise RuntimeError("simulated follow-up memory failure")

    monkeypatch.setattr(
        "app.services.followup_runner.build_debate_memory",
        _fail_memory,
    )

    debate_id = await _start_completed_debate(client)
    response = await client.post(
        f"/debates/{debate_id}/follow-ups", json={"question": FOLLOW_UP_Q}
    )
    assert response.status_code == 201, response.text

    turn = (await client.get(f"/debates/{debate_id}")).json()["latest_turn"]
    assert turn["status"] == "failed"
    assert turn["synthesis_status"] == "failed"
    assert turn["ended_at"] is not None
    assert turn["error"]["code"] == "UNKNOWN_ERROR"
    assert turn["error"]["cycle_number"] == 2
    assert all(
        round_["status"] not in {"queued", "running"}
        for round_ in turn["rounds"]
        if round_.get("cycle_number") == 2
    )
    assert all(
        round_["status"] == "completed"
        for round_ in turn["rounds"]
        if (round_.get("cycle_number") or 1) == 1
    )
