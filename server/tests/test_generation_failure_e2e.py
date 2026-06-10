"""
E2E generation failure tests.

Validates the full error-safety pipeline from provider failure through:
  - round status persistence
  - structured safe_error in WS events
  - debate loadability after failure
  - follow-up failure isolation (original cycles intact)

Uses the same in-memory SQLite setup as other integration tests.
No real LLM calls are made.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import Message
from app.models.round import Round, RoundStatus
from app.models.user import User
from app.schemas.contracts import (
    AgentContext,
    ExecutionEvent,
    ExecutionEventType,
    LLMRequest,
    LLMResponse,
    TurnContext,
)
from app.services.debate_engine.round_manager import RoundManager
from app.services.llm import _factory as llm_factory
from app.services.llm.exceptions import LLMGenerationError
from app.services.llm.provider_error_classifier import (
    PROVIDER_AUTH_ERROR,
    PROVIDER_QUOTA_EXCEEDED,
    ROUND_ALL_AGENTS_FAILED,
    MODEL_INVALID_JSON,
    MODEL_EMPTY_RESPONSE,
    STRUCTURED_VALIDATION_FAILED,
    classify_provider_error,
)
from app.services.llm.service import LLMService


# ── Fake providers ─────────────────────────────────────────────────────────────

class _QuotaExhaustedProvider(LLMService):
    """Simulates OpenRouter 402 / quota exhausted on every call."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        exc = Exception("OpenRouter API error 402: insufficient credits")
        safe = classify_provider_error(exc, provider="openrouter", model="test/model", status_code=402)
        err = LLMGenerationError("OpenRouter API error 402: insufficient credits")
        err.safe_error = safe  # type: ignore[attr-defined]
        raise err


class _InvalidKeyProvider(LLMService):
    """Simulates 401 invalid API key on every call."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        exc = Exception("OpenRouter API error 401: invalid api key")
        safe = classify_provider_error(exc, provider="openrouter", model="test/model", status_code=401)
        err = LLMGenerationError("OpenRouter API error 401: invalid api key")
        err.safe_error = safe  # type: ignore[attr-defined]
        raise err


class _SuccessProvider(LLMService):
    """Always returns a valid structured response."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(
            content=json.dumps({
                "stance": "yes",
                "main_argument": "Regulation is necessary",
                "key_points": ["Prevents harm", "Builds trust"],
                "confidence": 0.8,
                "response": "AI regulation is necessary to prevent misuse while preserving innovation.",
            }),
            prompt_tokens=20,
            completion_tokens=30,
            latency_ms=10,
        )


class _OneAgentFailsProvider(LLMService):
    """First call fails with quota error; subsequent calls succeed."""

    def __init__(self) -> None:
        self._calls = 0

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self._calls += 1
        if self._calls == 1:
            safe = classify_provider_error(
                Exception("OpenRouter API error 402: insufficient credits"),
                provider="openrouter",
                model="test/model",
                status_code=402,
            )
            err = LLMGenerationError("OpenRouter API error 402: insufficient credits")
            err.safe_error = safe  # type: ignore[attr-defined]
            raise err
        return LLMResponse(
            content=json.dumps({
                "stance": "yes",
                "main_argument": "Regulation is necessary",
                "key_points": ["Prevents harm"],
                "confidence": 0.7,
                "response": "AI regulation is necessary to prevent misuse.",
            }),
            prompt_tokens=20,
            completion_tokens=30,
            latency_ms=10,
        )


# ── Helpers ─────────────────────────────────────────────────────────────────

async def _seed_turn(
    db: AsyncSession,
    num_agents: int = 2,
) -> tuple[TurnContext, list[ChatAgent]]:
    user = User(
        id=uuid.uuid4(),
        email=f"e2e-err-{uuid.uuid4()}@test.com",
        password_hash="x",
        name="Test",
    )
    db.add(user)
    await db.flush()

    session = ChatSession(user_id=user.id, title="E2E Error Test")
    db.add(session)
    await db.flush()

    turn = ChatTurn(
        chat_session_id=session.id,
        turn_index=1,
        status=ChatTurnStatus.running,
        execution_mode="auto",
    )
    db.add(turn)
    await db.flush()

    agents: list[ChatAgent] = []
    for i in range(num_agents):
        agent = ChatAgent(
            chat_session_id=session.id,
            name=f"Agent{i}",
            role=f"Agent{i}",
            provider="openrouter",
            model="test/model",
            temperature=0.5,
            reasoning_style="balanced",
            position_order=i,
            is_active=True,
            knowledge_mode="no_docs",
            knowledge_strict=False,
        )
        db.add(agent)
        agents.append(agent)

    await db.flush()
    await db.commit()

    ctx = TurnContext(
        turn_id=turn.id,
        session_id=session.id,
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
                knowledge_mode=a.knowledge_mode or "no_docs",
                knowledge_strict=False,
                assigned_document_ids=[],
            )
            for a in agents
        ],
    )
    return ctx, agents


# ── Test 1: Quota exhausted → round failed + structured safe_error ─────────────

@pytest.mark.asyncio
async def test_quota_exhausted_all_agents_fail(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Provider returns 402 for every agent.

    Expected:
    - RuntimeError raised (round failed)
    - Round 1 persisted with status=failed
    - round_failed event emitted with safe_error
    - safe_error.code == PROVIDER_QUOTA_EXCEEDED
    - safe_error.retryable == True
    - No API key or Bearer token in the safe_error payload
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=2)

    emitted_events: list[ExecutionEvent] = []

    async def _on_event(event: ExecutionEvent) -> None:
        emitted_events.append(event)

    llm_factory.set_service(_QuotaExhaustedProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )

        with pytest.raises(RuntimeError, match="All agents failed"):
            await manager.execute_round_1(ctx)

    finally:
        llm_factory.reset_service()

    # Round persisted as failed
    round_obj = (
        await db_session.execute(
            select(Round).where(Round.chat_turn_id == ctx.turn_id, Round.round_number == 1)
        )
    ).scalar_one()
    assert round_obj.status == RoundStatus.failed

    # round_failed event emitted
    round_failed_events = [e for e in emitted_events if e.event_type == ExecutionEventType.round_failed]
    assert len(round_failed_events) == 1, "Expected exactly one round_failed event"

    rf_payload = round_failed_events[0].payload
    safe_error = rf_payload.get("error")
    assert isinstance(safe_error, dict), "round_failed payload must contain 'error' dict"
    # round_failed uses the round-level code (ROUND_ALL_AGENTS_FAILED)
    assert safe_error["code"] == ROUND_ALL_AGENTS_FAILED
    assert safe_error["retryable"] is True
    assert "user_message" in safe_error
    # No secrets in any emitted event
    assert "Bearer" not in str(safe_error)
    assert "sk-" not in str(safe_error)

    # Individual agent messages persisted with failed status
    msgs = (
        await db_session.execute(select(Message).where(Message.round_id == round_obj.id))
    ).scalars().all()
    assert len(msgs) == 2
    for msg in msgs:
        content = json.loads(msg.content or "{}")
        assert "error" in content

    # message_created events have safe_error with provider-level code
    mc_events = [e for e in emitted_events if e.event_type == ExecutionEventType.message_created]
    assert len(mc_events) == 2
    for mc in mc_events:
        assert mc.payload.get("generation_status") == "failed"
        se = mc.payload.get("safe_error")
        assert isinstance(se, dict), "message_created for failed agent must include safe_error"
        # Provider-level classification propagated to agent node
        assert se["code"] == PROVIDER_QUOTA_EXCEEDED


# ── Test 2: Invalid API key → PROVIDER_AUTH_ERROR ─────────────────────────────

@pytest.mark.asyncio
async def test_invalid_api_key_all_agents_fail(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Provider returns 401 for every agent.

    Expected:
    - safe_error.code == PROVIDER_AUTH_ERROR
    - Debate remains structurally loadable (round exists in DB with status failed)
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=2)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_InvalidKeyProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    round_obj = (
        await db_session.execute(
            select(Round).where(Round.chat_turn_id == ctx.turn_id, Round.round_number == 1)
        )
    ).scalar_one()
    assert round_obj.status == RoundStatus.failed

    rf_events = [e for e in emitted if e.event_type == ExecutionEventType.round_failed]
    assert rf_events, "Expected round_failed event"
    safe = rf_events[0].payload["error"]
    # round_failed uses round-level code; individual agents carry provider-level code in message_created
    assert safe["code"] == ROUND_ALL_AGENTS_FAILED

    # Individual message_created events carry provider-level code
    mc_fail = [e for e in emitted
               if e.event_type == ExecutionEventType.message_created
               and e.payload.get("generation_status") == "failed"]
    for mc in mc_fail:
        assert mc.payload.get("safe_error", {}).get("code") == PROVIDER_AUTH_ERROR

    # Debate still loadable — session and turn exist
    session_row = (
        await db_session.execute(
            select(ChatSession).where(ChatSession.id == ctx.session_id)
        )
    ).scalar_one_or_none()
    assert session_row is not None


# ── Test 3: One agent fails, others succeed ────────────────────────────────────

@pytest.mark.asyncio
async def test_one_agent_fails_round_continues(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    First agent call raises a quota error; subsequent calls succeed.

    Expected:
    - Round is partially_completed because usable output exists
    - One message has failed generation_status, two have success
    - Failed message_created event contains safe_error
    - Successful messages are persisted normally
    """
    ctx, agents = await _seed_turn(db_session, num_agents=3)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_OneAgentFailsProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        results = await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    failed_results = [r for r in results if r.generation_status == "failed"]
    success_results = [r for r in results if r.generation_status == "success"]
    assert len(failed_results) == 1
    assert len(success_results) == 2

    # Round explicitly records partial success while debate execution continues.
    round_obj = (
        await db_session.execute(
            select(Round).where(Round.chat_turn_id == ctx.turn_id, Round.round_number == 1)
        )
    ).scalar_one()
    assert round_obj.status == RoundStatus.partially_completed

    # All 3 messages persisted
    msgs = (
        await db_session.execute(select(Message).where(Message.round_id == round_obj.id))
    ).scalars().all()
    assert len(msgs) == 3

    # Failed message_created carries safe_error with provider-level code
    failed_mc = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert len(failed_mc) == 1
    se = failed_mc[0].payload.get("safe_error")
    assert isinstance(se, dict)
    assert se["code"] == PROVIDER_QUOTA_EXCEEDED

    # No round_failed event when partial success
    assert not any(e.event_type == ExecutionEventType.round_failed for e in emitted)


# ── Test 4: All agents fail in all 3 rounds → turn stays loadable ──────────────

@pytest.mark.asyncio
async def test_all_agents_fail_round1_turn_remains_loadable(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    All agents fail in Round 1. The turn is marked failed.
    The debate session (ChatSession) still exists in the database and is loadable.

    This verifies that a generation failure does not corrupt the debate structure.
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=2)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_QuotaExhaustedProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    # Debate session still exists and is queryable
    session_row = (
        await db_session.execute(
            select(ChatSession).where(ChatSession.id == ctx.session_id)
        )
    ).scalar_one_or_none()
    assert session_row is not None, "Debate session must exist after generation failure"

    # Round 1 persisted as failed
    round_obj = (
        await db_session.execute(
            select(Round).where(Round.chat_turn_id == ctx.turn_id)
        )
    ).scalar_one()
    assert round_obj.status == RoundStatus.failed
    assert round_obj.round_number == 1

    # round_failed event was emitted (not just RuntimeError raised silently)
    rf = [e for e in emitted if e.event_type == ExecutionEventType.round_failed]
    assert rf, "round_failed event must be emitted when all agents fail"
    safe = rf[0].payload["error"]
    assert safe["retryable"] is True
    assert "user_message" in safe

    # turn_failed event NOT emitted by RoundManager (that's ChatEngine's job)
    tf = [e for e in emitted if e.event_type == ExecutionEventType.turn_failed]
    assert not tf, "RoundManager must not emit turn_failed; ChatEngine owns that"


# ── Test 5: safe_error never contains secrets ──────────────────────────────────

@pytest.mark.asyncio
async def test_safe_error_payload_contains_no_secrets(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Ensure that even when a real error string contains token-like content,
    the safe_error dict that reaches frontend events is sanitized.
    """
    class _SecretLeakProvider(LLMService):
        async def generate(self, request: LLMRequest) -> LLMResponse:
            exc = Exception(
                "Request failed: Authorization: Bearer sk-secret-openrouter-key-abc 401 Unauthorized"
            )
            safe = classify_provider_error(
                exc, provider="openrouter", model="test/model", status_code=401
            )
            err = LLMGenerationError(str(exc))
            err.safe_error = safe  # type: ignore[attr-defined]
            raise err

    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_SecretLeakProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    all_safe_error_payloads = [
        str(e.payload.get("safe_error", {}))
        for e in emitted
        if e.payload.get("safe_error")
    ] + [
        str(e.payload.get("error", {}))
        for e in emitted
        if e.event_type == ExecutionEventType.round_failed
    ]
    combined = " ".join(all_safe_error_payloads)
    assert "sk-secret-openrouter-key-abc" not in combined, \
        "API key must never appear in safe_error or round_failed error payloads"
    assert "Bearer sk-" not in combined, \
        "Bearer token must never appear in safe_error or round_failed error payloads"


# ── Structured output failure tests ───────────────────────────────────────────


class _InvalidJsonProvider(LLMService):
    """Returns text that fails JSON parsing — normalizer falls back to plain text."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(
            content='{"response": "partial answer that never closes',
            prompt_tokens=10,
            completion_tokens=5,
            latency_ms=1,
        )


class _EmptyResponseProvider(LLMService):
    """Returns a completely empty string."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(content="", prompt_tokens=10, completion_tokens=0, latency_ms=1)


class _MissingFieldsProvider(LLMService):
    """Returns valid JSON but with no 'response'/'main_argument' field so validation fails."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(
            content=json.dumps({"stance": "pro", "key_points": ["a", "b"]}),
            prompt_tokens=10,
            completion_tokens=5,
            latency_ms=1,
        )


@pytest.mark.asyncio
async def test_invalid_json_response_classified_as_model_invalid_json(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Model returns truncated/invalid JSON.

    Expected:
    - Agent node marked failed
    - message_created safe_error.code == MODEL_INVALID_JSON
    - safe_error.retryable == True
    - Raw model output not in safe_error.user_message
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_InvalidJsonProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError, match="All agents failed"):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    # Round must be failed
    round_obj = (
        await db_session.execute(
            select(Round).where(Round.chat_turn_id == ctx.turn_id, Round.round_number == 1)
        )
    ).scalar_one()
    assert round_obj.status == RoundStatus.failed

    # message_created events
    mc_fail = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert len(mc_fail) == 1
    se = mc_fail[0].payload.get("safe_error")
    assert isinstance(se, dict), "failed message_created must include safe_error"
    assert se["code"] == MODEL_INVALID_JSON, f"Expected MODEL_INVALID_JSON, got {se['code']}"
    assert se["retryable"] is True
    assert "user_message" in se
    # Raw truncated JSON must not appear in the user-facing message
    assert "partial answer that never closes" not in se.get("user_message", "")


@pytest.mark.asyncio
async def test_empty_response_classified_as_model_empty_response(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Model returns empty string.

    Expected:
    - safe_error.code == MODEL_EMPTY_RESPONSE
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_EmptyResponseProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    mc_fail = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert mc_fail, "Expected at least one failed message_created"
    se = mc_fail[0].payload.get("safe_error")
    assert isinstance(se, dict)
    # Empty response can map to MODEL_EMPTY_RESPONSE or MODEL_INVALID_JSON depending on path
    assert se["code"] in (MODEL_EMPTY_RESPONSE, MODEL_INVALID_JSON), \
        f"Unexpected code: {se['code']}"
    assert se["retryable"] is True


@pytest.mark.asyncio
async def test_missing_required_fields_classified_as_structured_validation_failed(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    Model returns valid JSON but missing required response body fields.

    Expected:
    - safe_error.code == STRUCTURED_VALIDATION_FAILED
    - retryable == True
    - Raw JSON payload not in user_message
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_MissingFieldsProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    mc_fail = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert mc_fail, "Expected at least one failed message_created"
    se = mc_fail[0].payload.get("safe_error")
    assert isinstance(se, dict)
    assert se["code"] == STRUCTURED_VALIDATION_FAILED, f"Got {se['code']}"
    assert se["retryable"] is True
    # Raw JSON must not appear in user_message
    assert '"stance"' not in se.get("user_message", "")
    assert '"key_points"' not in se.get("user_message", "")


@pytest.mark.asyncio
async def test_structured_failure_safe_error_includes_round_and_agent_context(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    The safe_error on a structured failure must include provider, model,
    round_number, and agent_name for backend logging/debugging.
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_MissingFieldsProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    mc_fail = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert mc_fail
    se = mc_fail[0].payload.get("safe_error")
    assert isinstance(se, dict)
    assert se.get("provider") == "openrouter"
    assert se.get("model") == "test/model"
    assert se.get("round_number") == 1
    assert se.get("agent_name") is not None


@pytest.mark.asyncio
async def test_structured_failure_user_message_is_clean(
    db_session: AsyncSession,
    _test_session_factory,
) -> None:
    """
    The user_message in the safe_error must be human-readable and must not
    contain raw model output, JSON fragments, prompts, or stack traces.
    """
    ctx, _agents = await _seed_turn(db_session, num_agents=1)
    emitted: list[ExecutionEvent] = []

    async def _on_event(ev: ExecutionEvent) -> None:
        emitted.append(ev)

    llm_factory.set_service(_InvalidJsonProvider())
    try:
        manager = RoundManager(
            db=db_session,
            seq_start=1,
            on_event=_on_event,
            session_factory=_test_session_factory,
        )
        with pytest.raises(RuntimeError):
            await manager.execute_round_1(ctx)
    finally:
        llm_factory.reset_service()

    mc_fail = [
        e for e in emitted
        if e.event_type == ExecutionEventType.message_created
        and e.payload.get("generation_status") == "failed"
    ]
    assert mc_fail
    se = mc_fail[0].payload.get("safe_error")
    user_msg = se.get("user_message", "")
    # Must not contain raw model content or technical internals
    assert "partial answer" not in user_msg
    assert "traceback" not in user_msg.lower()
    assert "Traceback" not in user_msg
    assert "json_parse_failed" not in user_msg
    assert len(user_msg) > 10, "user_message must be a real sentence"
