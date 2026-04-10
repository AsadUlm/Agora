"""
Tests for the debate API (async execution model).

POST /debates/start returns immediately with status='queued'.
Because tests use httpx ASGITransport with FastAPI BackgroundTasks,
the background task (debate execution) runs to completion WITHIN the
ASGI lifecycle before the test's `await client.post(...)` resolves.

This means:
  - POST response always has status='queued'  (what the client sees in production)
  - After the await, the debate IS complete in the test database
  - Tests can call GET /debates/{id} to assert on the full persisted result
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


# ── POST /debates/start — response shape ─────────────────────────────────────

async def test_start_debate_returns_201(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    assert resp.status_code == 201


async def test_start_debate_response_schema(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    body = resp.json()

    assert "debate_id" in body
    assert "turn_id" in body
    assert body["question"] == "Should AI be regulated?"
    assert body["status"] == "queued"
    assert "ws_session_url" in body
    assert "ws_turn_url" in body


async def test_start_debate_ws_urls_reference_correct_ids(client: AsyncClient):
    resp = await client.post("/debates/start", json=_valid_payload())
    body = resp.json()

    assert body["ws_session_url"] == f"/ws/chat-sessions/{body['debate_id']}"
    assert body["ws_turn_url"] == f"/ws/chat-turns/{body['turn_id']}"


async def test_debate_id_is_valid_uuid(client: AsyncClient):
    import uuid

    resp = await client.post("/debates/start", json=_valid_payload())
    body = resp.json()
    uuid.UUID(body["debate_id"])
    uuid.UUID(body["turn_id"])


# ── Validation / error cases ─────────────────────────────────────────────────

async def test_empty_agents_returns_error(client: AsyncClient):
    payload = {"question": "Test?", "agents": []}
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 422


async def test_missing_question_returns_422(client: AsyncClient):
    payload = {"agents": [{"role": "Economist"}]}
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 422


async def test_missing_agents_key_returns_422(client: AsyncClient):
    payload = {"question": "Test?"}
    resp = await client.post("/debates/start", json=payload)
    assert resp.status_code == 422


# ── Persistence / retrieval (background task has run by assertion time) ───────

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


async def test_round1_messages_persisted(client: AsyncClient):
    """Round 1 produces one message per agent with expected structured fields."""
    num_agents = 3
    create_resp = await client.post("/debates/start", json=_valid_payload(num_agents))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    rounds = get_resp.json()["rounds"]

    round1 = next(r for r in rounds if r["round_number"] == 1)
    agent_outputs = round1["data"]

    assert len(agent_outputs) == num_agents
    for entry in agent_outputs:
        assert "agent_id" in entry
        assert "message_type" in entry
        data = entry["data"]
        assert "stance" in data
        assert "key_points" in data
        assert "confidence" in data


async def test_round2_messages_persisted(client: AsyncClient):
    """Round 2 produces one critique message per agent."""
    create_resp = await client.post("/debates/start", json=_valid_payload(2))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    rounds = get_resp.json()["rounds"]

    round2 = next(r for r in rounds if r["round_number"] == 2)
    agent_outputs = round2["data"]

    assert len(agent_outputs) == 2
    for entry in agent_outputs:
        assert "agent_id" in entry
        data = entry["data"]
        assert "critiques" in data
        for critique in data["critiques"]:
            assert "target_role" in critique
            assert "challenge" in critique


async def test_round3_messages_persisted(client: AsyncClient):
    """Round 3 produces one final synthesis message per agent."""
    num_agents = 2
    create_resp = await client.post("/debates/start", json=_valid_payload(num_agents))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    rounds = get_resp.json()["rounds"]

    round3 = next(r for r in rounds if r["round_number"] == 3)
    agent_outputs = round3["data"]

    assert len(agent_outputs) == num_agents
    for entry in agent_outputs:
        data = entry["data"]
        assert "final_stance" in data
        assert "recommendation" in data


async def test_completed_debate_status_in_db(client: AsyncClient):
    """After background execution, turn status is 'completed' in the DB."""
    create_resp = await client.post("/debates/start", json=_valid_payload(2))
    debate_id = create_resp.json()["debate_id"]

    get_resp = await client.get(f"/debates/{debate_id}")
    assert get_resp.json()["status"] == "completed"
