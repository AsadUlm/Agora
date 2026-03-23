"""
Tests for POST /debates/start.

All tests use the MockProvider so they are deterministic,
require no API keys, and run against an in-memory SQLite database.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


# ── Helper payloads ──────────────────────────────────────────────────────────

def _valid_payload(num_agents: int = 2) -> dict:
    roles = ["Economist", "Ethicist", "Engineer", "Scientist", "Lawyer"]
    return {
        "question": "Should AI be regulated?",
        "agents": [{"role": roles[i % len(roles)]} for i in range(num_agents)],
    }


# ── Happy path ───────────────────────────────────────────────────────────────

async def test_start_debate_returns_201(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    assert resp.status_code == 201


async def test_start_debate_response_schema(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    body = resp.json()

    assert "debate_id" in body
    assert body["question"] == "Should AI be regulated?"
    assert body["status"] == "completed"
    assert "result" in body


async def test_result_contains_all_three_rounds(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    result = resp.json()["result"]

    assert "round1" in result
    assert "round2" in result
    assert "round3" in result


async def test_round1_has_one_entry_per_agent(client: AsyncClient):
    num_agents = 3
    resp = await client.post("/debates/start", json=_valid_payload(num_agents))
    round1 = resp.json()["result"]["round1"]

    assert len(round1) == num_agents
    for entry in round1:
        assert "agent_id" in entry
        assert "role" in entry
        assert "stance" in entry
        assert "key_points" in entry
        assert "confidence" in entry
        assert entry["generation_status"] == "success"


async def test_round2_has_exchanges(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload(2))
    round2 = resp.json()["result"]["round2"]

    assert len(round2) >= 1
    for exchange in round2:
        assert "challenger_role" in exchange
        assert "responder_role" in exchange
        assert "challenge" in exchange
        assert "response" in exchange
        assert "rebuttal" in exchange
        assert exchange["generation_status"] == "success"


async def test_round3_has_syntheses(client: AsyncClient):
    num_agents = 2
    resp = await client.post("/debates/start", json=_valid_payload(num_agents))
    round3 = resp.json()["result"]["round3"]

    assert len(round3) == num_agents
    for entry in round3:
        assert "final_stance" in entry
        assert "recommendation" in entry


async def test_debate_id_is_valid_uuid(client: AsyncClient):
    import uuid

    resp = await client.post("/debates/start", json=_valid_payload())
    debate_id = resp.json()["debate_id"]
    # Should not raise
    uuid.UUID(debate_id)


# ── Validation / error cases ─────────────────────────────────────────────────

async def test_empty_agents_returns_error(client: AsyncClient):
    payload = {"question": "Test?", "agents": []}
    resp = await client.post("/debates/start", json=payload)
    # DebateEngine raises ValueError for empty agents → 500.
    assert resp.status_code == 500


async def test_missing_question_returns_422(client: AsyncClient):
    payload = {"agents": [{"role": "Economist"}]}
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 422


async def test_missing_agents_key_returns_422(client: AsyncClient):
    payload = {"question": "Test?"}
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 422


# ── Persistence / retrieval ──────────────────────────────────────────────────

async def test_debate_persisted_and_retrievable(client: AsyncClient):
    """POST creates a debate that can be fetched via GET with correct data."""
    create_resp = await client.post("/debates/start", json=_valid_payload(2))
    assert create_resp.status_code == 201
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    assert get_resp.status_code == 200

    body = get_resp.json()
    assert body["id"] == debate_id
    assert body["status"] == "completed"
    assert body["question"] == "Should AI be regulated?"


async def test_three_rounds_saved_in_db(client: AsyncClient):
    """All three rounds are persisted and returned by GET."""
    create_resp = await client.post("/debates/start", json=_valid_payload(2))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    rounds = get_resp.json()["rounds"]

    assert len(rounds) == 3
    round_numbers = [r["round_number"] for r in rounds]
    assert round_numbers == [1, 2, 3]


async def test_agents_saved_in_db(client: AsyncClient):
    """Agent records are persisted and returned by GET."""
    num_agents = 3
    create_resp = await client.post("/debates/start", json=_valid_payload(num_agents))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    agents = get_resp.json()["agents"]

    assert len(agents) == num_agents
    for agent in agents:
        assert "id" in agent
        assert "role" in agent


async def test_round3_generation_status(client: AsyncClient):
    """Round 3 entries include generation_status = success with mock provider."""
    resp = await client.post("/debates/start", json=_valid_payload(2))
    round3 = resp.json()["result"]["round3"]

    for entry in round3:
        assert entry["generation_status"] == "success"
        assert "error" not in entry
