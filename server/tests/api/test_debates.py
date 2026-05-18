"""
Tests for the debate API (async execution model + Step 6 DTO shaping).

POST /debates/start returns immediately with status='queued'.
Because tests use httpx ASGITransport with FastAPI BackgroundTasks,
the background task (debate execution) runs to completion WITHIN the
ASGI lifecycle before the test's `await client.post(...)` resolves.

This means:
  - POST response always has status='queued'  (what the client sees in production)
  - After the await, the debate IS complete in the test database
  - Tests can call GET /debates/{id} to assert on the full persisted result

Step 6 response shape for GET /debates/{id}:
  {
    "id", "title", "question", "status", "created_at", "updated_at",
    "agents": [{id, role, provider, model, temperature, reasoning_style, position_order}],
    "latest_turn": {
      "id", "turn_index", "status", "started_at", "ended_at",
      "user_message": {"content", "created_at"},
      "rounds": [
        {
          "id", "round_number", "round_type", "status", "started_at", "ended_at",
          "messages": [{id, agent_id, agent_role, message_type, sender_type,
                        payload, text, sequence_no, created_at}]
        }
      ],
      "final_summary": {...} | null
    }
  }
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


def _rounds(body: dict) -> list:
    """Convenience: extract rounds from the new nested response."""
    return body["latest_turn"]["rounds"]


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


# ── GET /debates/{id} — Step 6 response shape ────────────────────────────────

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


async def test_session_detail_top_level_fields(client: AsyncClient):
    """GET /debates/{id} returns all expected top-level SessionDetailOut fields."""
    debate_id = (await client.post("/debates/start", json=_valid_payload())).json()["debate_id"]
    body = (await client.get(f"/debates/{debate_id}")).json()

    for field in ("id", "title", "question", "status", "created_at", "updated_at",
                  "agents", "latest_turn"):
        assert field in body, f"Missing field: {field}"


async def test_session_detail_has_latest_turn(client: AsyncClient):
    """latest_turn must be present and correctly structured after execution."""
    debate_id = (await client.post("/debates/start", json=_valid_payload())).json()["debate_id"]
    body = (await client.get(f"/debates/{debate_id}")).json()

    turn = body["latest_turn"]
    assert turn is not None
    for field in ("id", "turn_index", "status", "rounds", "user_message"):
        assert field in turn, f"Missing turn field: {field}"


async def test_user_message_content_in_turn(client: AsyncClient):
    """latest_turn.user_message.content == the original question."""
    question = "Is democracy the best system?"
    payload = {"question": question, "agents": [{"role": "Historian"}, {"role": "Philosopher"}]}
    debate_id = (await client.post("/debates/start", json=payload)).json()["debate_id"]
    body = (await client.get(f"/debates/{debate_id}")).json()

    assert body["latest_turn"]["user_message"]["content"] == question


async def test_three_rounds_saved_in_db(client: AsyncClient):
    """All three rounds are persisted and available under latest_turn.rounds."""
    debate_id = (await client.post("/debates/start", json=_valid_payload(2))).json()["debate_id"]
    body = (await client.get(f"/debates/{debate_id}")).json()

    rounds = _rounds(body)
    assert len(rounds) == 3
    assert [r["round_number"] for r in rounds] == [1, 2, 3]


async def test_rounds_have_required_fields(client: AsyncClient):
    """Each round has all RoundOut fields."""
    debate_id = (await client.post("/debates/start", json=_valid_payload(2))).json()["debate_id"]
    rounds = _rounds((await client.get(f"/debates/{debate_id}")).json())

    for round_ in rounds:
        for field in ("id", "round_number", "round_type", "status", "messages"):
            assert field in round_, f"Round missing field: {field}"


async def test_agents_saved_in_db(client: AsyncClient):
    """Agent records are persisted and returned with full AgentOut fields."""
    num_agents = 3
    debate_id = (await client.post("/debates/start", json=_valid_payload(num_agents))).json()["debate_id"]
    agents = (await client.get(f"/debates/{debate_id}")).json()["agents"]

    assert len(agents) == num_agents
    for agent in agents:
        for field in ("id", "role", "provider", "model"):
            assert field in agent, f"Agent missing field: {field}"


async def test_round1_messages_persisted(client: AsyncClient):
    """Round 1 produces one message per agent with structured payload fields."""
    num_agents = 3
    debate_id = (await client.post("/debates/start", json=_valid_payload(num_agents))).json()["debate_id"]
    rounds = _rounds((await client.get(f"/debates/{debate_id}")).json())

    round1 = next(r for r in rounds if r["round_number"] == 1)
    messages = round1["messages"]

    assert len(messages) == num_agents
    for msg in messages:
        assert "agent_id" in msg
        assert "agent_role" in msg
        assert "message_type" in msg
        assert "payload" in msg
        assert "text" in msg
        payload = msg["payload"]
        assert "stance" in payload
        assert "key_points" in payload
        assert "confidence" in payload


async def test_messages_have_agent_role_denormalized(client: AsyncClient):
    """agent_role is embedded in each message — no cross-ref needed."""
    debate_id = (await client.post("/debates/start", json=_valid_payload(2))).json()["debate_id"]
    rounds = _rounds((await client.get(f"/debates/{debate_id}")).json())

    for round_ in rounds:
        for msg in round_["messages"]:
            assert msg["agent_role"] is not None
            assert isinstance(msg["agent_role"], str)
            assert len(msg["agent_role"]) > 0


async def test_round2_messages_persisted(client: AsyncClient):
    """Round 2 produces one critique message per agent."""
    debate_id = (await client.post("/debates/start", json=_valid_payload(2))).json()["debate_id"]
    rounds = _rounds((await client.get(f"/debates/{debate_id}")).json())

    round2 = next(r for r in rounds if r["round_number"] == 2)
    messages = round2["messages"]

    assert len(messages) == 2
    for msg in messages:
        assert "agent_id" in msg
        payload = msg["payload"]
        assert "critiques" in payload
        for critique in payload["critiques"]:
            assert "target_role" in critique
            assert "challenge" in critique


async def test_round3_messages_persisted(client: AsyncClient):
    """Round 3 produces one final synthesis message per agent."""
    num_agents = 2
    debate_id = (await client.post("/debates/start", json=_valid_payload(num_agents))).json()["debate_id"]
    rounds = _rounds((await client.get(f"/debates/{debate_id}")).json())

    round3 = next(r for r in rounds if r["round_number"] == 3)
    messages = round3["messages"]

    assert len(messages) == num_agents
    for msg in messages:
        payload = msg["payload"]
        assert "final_stance" in payload
        assert "recommendation" in payload


async def test_completed_debate_status_in_db(client: AsyncClient):
    """After background execution, status is 'completed' at session level."""
    debate_id = (await client.post("/debates/start", json=_valid_payload(2))).json()["debate_id"]
    body = (await client.get(f"/debates/{debate_id}")).json()
    assert body["status"] == "completed"
    assert body["latest_turn"]["status"] == "completed"


# ── GET /debates/{id}/turns/{turn_id} ─────────────────────────────────────────

async def test_get_turn_endpoint_returns_200(client: AsyncClient):
    """GET /debates/{id}/turns/{turn_id} returns 200 with TurnOut shape."""
    resp = await client.post("/debates/start", json=_valid_payload(2))
    body = resp.json()
    debate_id = body["debate_id"]
    turn_id = body["turn_id"]

    turn_resp = await client.get(f"/debates/{debate_id}/turns/{turn_id}")
    assert turn_resp.status_code == 200

    turn = turn_resp.json()
    assert turn["id"] == turn_id
    assert turn["status"] == "completed"
    assert len(turn["rounds"]) == 3
    assert turn["user_message"]["content"] == "Should AI be regulated?"


async def test_get_turn_wrong_session_returns_404(client: AsyncClient):
    """Turn endpoint returns 404 when debate_id doesn't own the turn."""
    import uuid
    resp = await client.post("/debates/start", json=_valid_payload(2))
    turn_id = resp.json()["turn_id"]

    fake_session_id = str(uuid.uuid4())
    turn_resp = await client.get(f"/debates/{fake_session_id}/turns/{turn_id}")
    assert turn_resp.status_code == 404


# ── GET /debates — list ───────────────────────────────────────────────────────

async def test_list_debates_returns_list(client: AsyncClient):
    """GET /debates returns a list including the created debate."""
    await client.post("/debates/start", json=_valid_payload(2))
    list_resp = await client.get("/debates")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    for item in items:
        for field in ("id", "title", "question", "status", "created_at"):
            assert field in item, f"List item missing field: {field}"
