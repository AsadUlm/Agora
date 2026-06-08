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

from httpx import AsyncClient

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
    # Cycle 1 (rounds 1-3) + cycle 2 follow-up (rounds 4-6).
    assert len(rounds) == 6
    _assert_all_rounds_completed(rounds)

    cycle2 = [r for r in rounds if r.get("cycle_number") == 2]
    types = {r["round_type"] for r in cycle2}
    assert types == {"followup_response", "followup_critique", "updated_synthesis"}
    # The follow-up response round must carry rendered messages, not be empty.
    resp_round = next(r for r in cycle2 if r["round_type"] == "followup_response")
    assert len(resp_round["messages"]) >= 1


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
    # 3 cycles × 3 rounds — earlier cycles must not be overwritten.
    assert len(rounds) == 9, f"Expected 9 rounds, got {len(rounds)}"
    _assert_all_rounds_completed(rounds)
    assert {r.get("cycle_number") for r in rounds} == {1, 2, 3}


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
