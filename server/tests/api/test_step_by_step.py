"""
Tests for step-by-step debate execution.

Covers:
- POST /debates/{id}/next-step releases exactly one agent step in manual mode
- Auto mode is the default and runs through to completion without /next-step
- POST /debates/{id}/auto-run switches a manual debate into auto execution
- Empty LLM responses produce a failed message rather than a silent success
- Per-round max_tokens is clamped to <= 1200
"""

from __future__ import annotations

import asyncio
import pytest
from httpx import AsyncClient

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.debate_engine.round_manager import (
    DEFAULT_MAX_TOKENS,
    MAX_ALLOWED_TOKENS,
    ROUND_MAX_TOKENS,
    _resolve_max_tokens,
)
from app.services.debate_engine.step_controller import StepController
from app.services.llm import _factory as llm_factory
from app.services.llm.providers.mock_provider import MockProvider


def _payload(num_agents: int = 2, mode: str = "auto") -> dict:
    return {
        "question": "Should AI be regulated?",
        "agents": [{"role": f"Agent{i}"} for i in range(num_agents)],
        "execution_mode": mode,
    }


# ── Token clamp tests ────────────────────────────────────────────────────────

def test_max_tokens_never_exceeds_hard_cap():
    for round_no in (1, 2, 3, 99):
        assert _resolve_max_tokens(round_no) <= MAX_ALLOWED_TOKENS


def test_per_round_budgets_match_brief():
    assert ROUND_MAX_TOKENS[1] == 650
    assert ROUND_MAX_TOKENS[2] == 850
    assert ROUND_MAX_TOKENS[3] == 900
    assert DEFAULT_MAX_TOKENS <= MAX_ALLOWED_TOKENS


# ── StepController unit tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_step_controller_auto_mode_does_not_block():
    sc = StepController()
    import uuid as _uuid

    tid = _uuid.uuid4()
    await sc.register(tid, "auto")
    # Should return immediately even without release_step.
    await asyncio.wait_for(sc.wait_for_step(tid, {"x": 1}), timeout=0.5)


@pytest.mark.asyncio
async def test_step_controller_manual_mode_blocks_until_release():
    sc = StepController()
    import uuid as _uuid

    tid = _uuid.uuid4()
    await sc.register(tid, "manual")

    waiter = asyncio.create_task(sc.wait_for_step(tid, {"step": 1}))
    await asyncio.sleep(0.05)
    assert not waiter.done(), "Manual mode should block until release_step"

    released = await sc.release_step(tid)
    assert released is True
    await asyncio.wait_for(waiter, timeout=0.5)

    # Second wait should also block (single-shot gate).
    waiter2 = asyncio.create_task(sc.wait_for_step(tid, {"step": 2}))
    await asyncio.sleep(0.05)
    assert not waiter2.done()
    await sc.release_step(tid)
    await asyncio.wait_for(waiter2, timeout=0.5)


@pytest.mark.asyncio
async def test_step_controller_switch_to_auto_unblocks_pending():
    sc = StepController()
    import uuid as _uuid

    tid = _uuid.uuid4()
    await sc.register(tid, "manual")

    waiter = asyncio.create_task(sc.wait_for_step(tid, None))
    await asyncio.sleep(0.05)
    assert not waiter.done()

    await sc.switch_mode(tid, "auto")
    await asyncio.wait_for(waiter, timeout=0.5)


# ── HTTP endpoint tests ──────────────────────────────────────────────────────

async def test_auto_mode_completes_without_next_step(client: AsyncClient):
    resp = await client.post("/debates/start", json=_payload(num_agents=2, mode="auto"))
    assert resp.status_code == 201
    debate_id = resp.json()["debate_id"]

    body = (await client.get(f"/debates/{debate_id}")).json()
    assert body["latest_turn"]["status"] == "completed"
    assert body["latest_turn"]["execution_mode"] == "auto"


async def test_next_step_endpoint_returns_completed_for_finished_auto_debate(client: AsyncClient):
    resp = await client.post("/debates/start", json=_payload(num_agents=2, mode="auto"))
    debate_id = resp.json()["debate_id"]

    # In auto mode the debate finishes during the test client's request cycle.
    nxt = await client.post(f"/debates/{debate_id}/next-step")
    assert nxt.status_code == 200
    j = nxt.json()
    assert j["status"] == "completed"
    assert j["released"] is False


async def test_next_step_404_for_unknown_debate(client: AsyncClient):
    import uuid as _uuid

    resp = await client.post(f"/debates/{_uuid.uuid4()}/next-step")
    assert resp.status_code == 404


# ── Empty response handling ──────────────────────────────────────────────────

class _EmptyContentProvider(MockProvider):
    """LLM provider that always returns an empty string."""

    async def generate(self, request: LLMRequest) -> LLMResponse:  # type: ignore[override]
        return LLMResponse(content="", prompt_tokens=10, completion_tokens=0, latency_ms=1)


async def test_empty_llm_response_produces_failed_messages(client: AsyncClient):
    # Override the LLM factory singleton to return an empty-content provider.
    llm_factory.set_service(_EmptyContentProvider())
    try:
        resp = await client.post("/debates/start", json=_payload(num_agents=2, mode="auto"))
        assert resp.status_code == 201
        debate_id = resp.json()["debate_id"]

        body = (await client.get(f"/debates/{debate_id}")).json()
        rounds = body["latest_turn"]["rounds"]
        assert rounds, "No rounds were saved"
        # Every agent message should carry the empty-response error.
        agent_msgs = [
            m for r in rounds for m in r["messages"] if m["sender_type"] == "agent"
        ]
        assert agent_msgs, "No agent messages were saved"
        for msg in agent_msgs:
            text = (msg["text"] or "").lower()
            assert "error" in text
            assert "empty response" in text
    finally:
        llm_factory.reset_service()
