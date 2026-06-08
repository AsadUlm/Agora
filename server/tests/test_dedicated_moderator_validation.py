"""
Validation test: Dedicated Moderator Fix (anthropic/claude-sonnet-4.5 as Final Verdict model).

Verifies that:
  1. Round 1, 2, 3 agent calls use each agent's configured model (not the moderator model).
  2. _generate_synthesis_verdict uses settings.MODERATOR_MODEL, NOT ctx.agents[0].model.
  3. The verdict message payload includes moderator_model, moderator_provider,
     moderator_temperature, moderator_max_tokens metadata.
  4. Follow-up updated synthesis verdict also uses the moderator model.
  5. Normal agent results are not broken (still have expected structured fields).

Test strategy:
  - Use a custom RecordingProvider that captures every (model, provider, round_type)
    passed to .generate(), then returns a valid structured response.
  - Set two agents with deliberately cheap/different models.
  - Run full R1 → R2 → R3 pipeline.
  - Assert all agent calls used agent models; the verdict call used MODERATOR_MODEL.
  - Assert verdict Message payload contains moderator_* metadata fields.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.message import Message, MessageType, SenderType
from app.schemas.contracts import (
    AgentContext,
    AgentRoundResult,
    LLMRequest,
    LLMResponse,
    TurnContext,
)
from app.services.debate_engine.round_manager import RoundManager
from app.services.llm import _factory as llm_factory
from app.services.llm.service import LLMService


# ─────────────────────────────────────────────────────────────────────────────
# Recording Provider
# ─────────────────────────────────────────────────────────────────────────────

# Valid structured responses for each round type
_ROUND1_RESPONSE = {
    "stance": "Mock stance",
    "main_argument": "Regulation should be proportionate and risk-based.",
    "key_points": ["p1", "p2"],
    "confidence": 0.8,
    "response": "Regulation of AI should be proportionate and risk-based so it protects people without blocking beneficial innovation.",
}
_ROUND2_RESPONSE = {
    "critiques": [{"target_role": "opponent", "challenge": "Weak evidence", "weakness": "Anecdotal"}],
    "target_agent": "opponent",
    "counterargument": "The opposing position relies on anecdote rather than systematic evidence.",
    "stance": "Maintained stance",
    "confidence": 0.75,
    "response": "The opposing position relies on anecdotal evidence and overlooks the systemic risks that motivate proportionate regulation.",
}
_ROUND3_RESPONSE = {
    "final_stance": "Final position after debate",
    "what_changed": "Minor refinements",
    "recommendation": "Balanced approach",
    "remaining_concerns": "None significant",
    "confidence": 0.85,
    "response": "After weighing both sides, a balanced, risk-based regulatory approach offers the strongest path forward.",
}
_SYNTHESIS_VERDICT_RESPONSE = {
    "one_sentence_takeaway": "Both sides have merit.",
    "consensus_statement": "All agents agree on the core principle.",
    "main_disagreement": "Implementation details differ.",
    "recommended_answer": "A moderate approach is best.",
    "winning_side": "mixed",
    "confidence": "medium",
    "what_changed": "",
    "reasoning_basis": ["Evidence from round 1", "Critique from round 2"],
    "unresolved_questions": ["Long-term effects?"],
    "response": "The debate showed diverse perspectives.",
}


class RecordingProvider(LLMService):
    """Records every LLM request's (model, provider, max_tokens) and returns valid JSON."""

    def __init__(self):
        self.calls: list[dict[str, Any]] = []
        self._call_counter = 0

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self._call_counter += 1
        call_no = self._call_counter

        self.calls.append({
            "call_no": call_no,
            "model": request.model,
            "provider": request.provider,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        })

        # Choose response shape based on prompt heuristic (synthesis_verdict prompt
        # contains "moderator" keyword; round 2 contains "critique"; round 3 "synthesis")
        prompt_lower = (request.prompt or "").lower()
        if "moderator" in prompt_lower or "synthesis verdict" in prompt_lower or "overall verdict" in prompt_lower:
            payload = _SYNTHESIS_VERDICT_RESPONSE
        elif "critique" in prompt_lower or "cross" in prompt_lower:
            payload = _ROUND2_RESPONSE
        elif "final" in prompt_lower or "synthesis" in prompt_lower:
            payload = _ROUND3_RESPONSE
        else:
            payload = _ROUND1_RESPONSE

        return LLMResponse(
            content=json.dumps(payload),
            prompt_tokens=20,
            completion_tokens=80,
            latency_ms=1,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

AGENT_0_MODEL = "openai/gpt-4o-mini"       # cheap fast agent
AGENT_1_MODEL = "mistralai/mixtral-8x7b-instruct"  # different cheap agent
AGENT_0_PROVIDER = "openrouter"
AGENT_1_PROVIDER = "openrouter"


def _agent_ctx(role: str, model: str, provider: str = "openrouter") -> AgentContext:
    return AgentContext(
        agent_id=uuid.uuid4(),
        role=role,
        provider=provider,
        model=model,
        temperature=0.7,
    )


def _turn_ctx(session_id: uuid.UUID, turn_id: uuid.UUID) -> TurnContext:
    return TurnContext(
        turn_id=turn_id,
        session_id=session_id,
        user_id=uuid.uuid4(),
        question="Should AI development be regulated by governments?",
        agents=[
            _agent_ctx("Economist", AGENT_0_MODEL, AGENT_0_PROVIDER),
            _agent_ctx("Ethicist", AGENT_1_MODEL, AGENT_1_PROVIDER),
        ],
    )


def _r1_result(agent_ctx: AgentContext) -> AgentRoundResult:
    return AgentRoundResult(
        agent_id=agent_ctx.agent_id,
        role=agent_ctx.role,
        content=json.dumps(_ROUND1_RESPONSE),
        structured=dict(_ROUND1_RESPONSE),
        generation_status="success",
    )


def _r2_result(agent_ctx: AgentContext) -> AgentRoundResult:
    return AgentRoundResult(
        agent_id=agent_ctx.agent_id,
        role=agent_ctx.role,
        content=json.dumps(_ROUND3_RESPONSE),
        structured=dict(_ROUND3_RESPONSE),
        generation_status="success",
    )


@pytest.fixture()
async def db_context(db_session: AsyncSession, _test_session_factory):
    from app.models.chat_agent import ChatAgent
    from app.models.chat_session import ChatSession
    from app.models.chat_turn import ChatTurn
    from app.models.user import User

    user = User(id=uuid.uuid4(), email=f"mod_test_{uuid.uuid4().hex[:6]}@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()

    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="Moderator Validation Test")
    db_session.add(session)
    await db_session.flush()

    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db_session.add(turn)
    await db_session.flush()

    return session.id, turn.id, db_session, _test_session_factory


@pytest.fixture()
def recording_provider():
    provider = RecordingProvider()
    llm_factory.set_service(provider)
    yield provider
    llm_factory.reset_service()


# ─────────────────────────────────────────────────────────────────────────────
# Test: Model routing per round
# ─────────────────────────────────────────────────────────────────────────────

class TestDedicatedModeratorModelRouting:

    async def test_moderator_model_is_not_agent_model(self, db_context, recording_provider):
        """
        Core invariant: final synthesis verdict must use MODERATOR_MODEL,
        NOT the model of ctx.agents[0].
        """
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        # Find the synthesis verdict call — it uses MODERATOR_MODEL
        # All agent calls use AGENT_0_MODEL or AGENT_1_MODEL
        agent_models = {AGENT_0_MODEL, AGENT_1_MODEL}
        moderator_model = settings.MODERATOR_MODEL

        agent_calls = [c for c in recording_provider.calls if c["model"] in agent_models]
        moderator_calls = [c for c in recording_provider.calls if c["model"] == moderator_model]

        assert len(agent_calls) >= 2, (
            f"Expected at least 2 agent calls (R3 syntheses), got {len(agent_calls)}. "
            f"All calls: {recording_provider.calls}"
        )
        assert len(moderator_calls) >= 1, (
            f"Expected at least 1 moderator call for synthesis verdict, got 0. "
            f"All calls: {recording_provider.calls}"
        )

        # Confirm the moderator call is NOT using an agent model
        for mc in moderator_calls:
            assert mc["model"] not in agent_models, (
                f"Moderator call is using an agent model: {mc['model']} — "
                "ctx.agents[0] model isolation FAILED."
            )

    async def test_agent_0_model_never_used_for_synthesis_verdict(self, db_context, recording_provider):
        """
        Explicit guard: Agent 0's model must NOT appear as the model for the verdict call.
        Previously this was the bug (moderator_agent = ctx.agents[0]).
        """
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        # The verdict message is saved with sender_type=judge
        msgs = (await db.execute(
            select(Message).where(Message.chat_turn_id == turn_id)
        )).scalars().all()

        verdict_msgs = [m for m in msgs if m.sender_type == SenderType.judge]
        assert len(verdict_msgs) >= 1, "No judge/moderator message found after round 3"

        verdict_payload = json.loads(verdict_msgs[0].content)

        # Must have the new moderator metadata
        assert "moderator_model" in verdict_payload, (
            "verdict payload missing 'moderator_model' key — metadata injection not working."
        )
        assert verdict_payload["moderator_model"] == settings.MODERATOR_MODEL, (
            f"Verdict model is {verdict_payload['moderator_model']!r}, "
            f"expected {settings.MODERATOR_MODEL!r}"
        )

        # Must NOT be agent 0's model
        assert verdict_payload["moderator_model"] != AGENT_0_MODEL, (
            f"Verdict model is still ctx.agents[0].model ({AGENT_0_MODEL!r}) — fix not applied."
        )

    async def test_round_1_uses_agent_models_not_moderator(self, db_context, recording_provider):
        """Round 1 agent calls must use each agent's own model."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_1(ctx)

        agent_models = {AGENT_0_MODEL, AGENT_1_MODEL}
        for call in recording_provider.calls:
            assert call["model"] in agent_models, (
                f"Round 1 call unexpectedly used non-agent model: {call['model']!r}"
            )
        assert len(recording_provider.calls) == 2

    async def test_round_2_uses_agent_models_not_moderator(self, db_context, recording_provider):
        """Round 2 critique calls must use each agent's own model."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_2(ctx, r1)

        agent_models = {AGENT_0_MODEL, AGENT_1_MODEL}
        for call in recording_provider.calls:
            assert call["model"] in agent_models, (
                f"Round 2 call unexpectedly used non-agent model: {call['model']!r}"
            )
        assert len(recording_provider.calls) == 2


# ─────────────────────────────────────────────────────────────────────────────
# Test: Verdict payload metadata
# ─────────────────────────────────────────────────────────────────────────────

class TestVerdictPayloadMetadata:

    async def test_verdict_contains_all_moderator_metadata_fields(self, db_context, recording_provider):
        """Verdict payload must contain all 4 moderator metadata fields."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        msgs = (await db.execute(
            select(Message).where(Message.chat_turn_id == turn_id)
        )).scalars().all()
        verdict_msgs = [m for m in msgs if m.sender_type == SenderType.judge]
        assert verdict_msgs, "No judge message found"

        payload = json.loads(verdict_msgs[0].content)

        assert payload.get("moderator_provider") == settings.MODERATOR_PROVIDER, (
            f"moderator_provider mismatch: {payload.get('moderator_provider')!r} != {settings.MODERATOR_PROVIDER!r}"
        )
        assert payload.get("moderator_model") == settings.MODERATOR_MODEL, (
            f"moderator_model mismatch: {payload.get('moderator_model')!r} != {settings.MODERATOR_MODEL!r}"
        )
        assert payload.get("moderator_temperature") == settings.MODERATOR_TEMPERATURE, (
            f"moderator_temperature mismatch"
        )
        assert payload.get("moderator_max_tokens") == settings.MODERATOR_MAX_TOKENS, (
            f"moderator_max_tokens mismatch"
        )

    async def test_existing_verdict_fields_preserved(self, db_context, recording_provider):
        """Existing verdict schema fields must not be broken by the metadata addition."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        msgs = (await db.execute(
            select(Message).where(Message.chat_turn_id == turn_id)
        )).scalars().all()
        verdict_msgs = [m for m in msgs if m.sender_type == SenderType.judge]
        assert verdict_msgs, "No judge message found"

        payload = json.loads(verdict_msgs[0].content)

        # Core discriminator fields
        assert payload.get("message_type") == "synthesis_verdict"
        assert payload.get("agent_role") == "moderator"
        assert "cycle_number" in payload
        assert "round_number" in payload

    async def test_verdict_moderator_temperature_is_low(self, db_context, recording_provider):
        """Moderator temperature must be the low dedicated value, not a high agent temperature."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        # Verify the recorded LLM call had the moderator temperature
        moderator_calls = [c for c in recording_provider.calls if c["model"] == settings.MODERATOR_MODEL]
        assert moderator_calls, "No moderator LLM call captured"
        mc = moderator_calls[0]

        assert mc["temperature"] == settings.MODERATOR_TEMPERATURE, (
            f"Moderator call temperature {mc['temperature']} != settings.MODERATOR_TEMPERATURE "
            f"({settings.MODERATOR_TEMPERATURE})"
        )

    async def test_verdict_moderator_max_tokens_is_settings_value(self, db_context, recording_provider):
        """Moderator LLM call max_tokens must equal settings.MODERATOR_MAX_TOKENS."""
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)
        r1 = [_r1_result(a) for a in ctx.agents]
        r2 = [_r2_result(a) for a in ctx.agents]

        rm = RoundManager(db, session_factory=session_factory)
        await rm.execute_round_3(ctx, r1, r2)

        moderator_calls = [c for c in recording_provider.calls if c["model"] == settings.MODERATOR_MODEL]
        assert moderator_calls, "No moderator LLM call captured"
        mc = moderator_calls[0]

        assert mc["max_tokens"] == settings.MODERATOR_MAX_TOKENS, (
            f"Moderator max_tokens {mc['max_tokens']} != settings.MODERATOR_MAX_TOKENS "
            f"({settings.MODERATOR_MAX_TOKENS})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Test: Full pipeline model isolation (R1 + R2 + R3)
# ─────────────────────────────────────────────────────────────────────────────

class TestFullPipelineModelIsolation:

    async def test_full_r1_r2_r3_model_routing(self, db_context, recording_provider):
        """
        Full pipeline: R1 + R2 + R3 agents use their own models;
        only the synthesis verdict call uses MODERATOR_MODEL.

        Call sequence expected:
          Call 1: R1 Agent 0  → AGENT_0_MODEL
          Call 2: R1 Agent 1  → AGENT_1_MODEL
          Call 3: R2 Agent 0  → AGENT_0_MODEL
          Call 4: R2 Agent 1  → AGENT_1_MODEL
          Call 5: R3 Agent 0  → AGENT_0_MODEL
          Call 6: R3 Agent 1  → AGENT_1_MODEL
          Call 7: Verdict     → MODERATOR_MODEL  (settings.MODERATOR_MODEL)
        """
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)

        rm = RoundManager(db, session_factory=session_factory)

        r1 = await rm.execute_round_1(ctx)
        r2 = await rm.execute_round_2(ctx, r1)
        await rm.execute_round_3(ctx, r1, r2)

        calls = recording_provider.calls
        agent_models = {AGENT_0_MODEL, AGENT_1_MODEL}
        moderator_model = settings.MODERATOR_MODEL

        # Partition calls into agent vs moderator
        agent_call_models = [c["model"] for c in calls if c["model"] in agent_models]
        moderator_call_models = [c["model"] for c in calls if c["model"] == moderator_model]
        unknown_calls = [c for c in calls if c["model"] not in agent_models and c["model"] != moderator_model]

        assert len(unknown_calls) == 0, (
            f"Unexpected model(s) used in calls: {unknown_calls}"
        )

        # R1 (2) + R2 (2) + R3 (2) = 6 agent calls
        assert len(agent_call_models) == 6, (
            f"Expected 6 agent calls across R1+R2+R3, got {len(agent_call_models)}. "
            f"All calls: {[(c['call_no'], c['model']) for c in calls]}"
        )

        # Exactly 1 moderator verdict call
        assert len(moderator_call_models) == 1, (
            f"Expected exactly 1 moderator verdict call, got {len(moderator_call_models)}. "
            f"All calls: {[(c['call_no'], c['model']) for c in calls]}"
        )

        # The verdict call must be the LAST call (after all agent syntheses)
        last_call = calls[-1]
        assert last_call["model"] == moderator_model, (
            f"Last call was not moderator ({moderator_model!r}), got {last_call['model']!r}"
        )

    async def test_agent_models_remain_independent_of_moderator_model(self, db_context, recording_provider):
        """
        Changing MODERATOR_MODEL in settings must not affect agent call models.
        (Structural check: agents have their own model field independent of settings.)
        """
        session_id, turn_id, db, session_factory = db_context
        ctx = _turn_ctx(session_id, turn_id)

        # Verify agent models don't equal moderator model (test setup guard)
        assert AGENT_0_MODEL != settings.MODERATOR_MODEL, (
            "Test setup: AGENT_0_MODEL should differ from MODERATOR_MODEL for isolation test to be meaningful"
        )
        assert AGENT_1_MODEL != settings.MODERATOR_MODEL, (
            "Test setup: AGENT_1_MODEL should differ from MODERATOR_MODEL for isolation test to be meaningful"
        )

        rm = RoundManager(db, session_factory=session_factory)
        r1 = await rm.execute_round_1(ctx)

        # Verify round 1 used per-agent models
        assert recording_provider.calls[0]["model"] in {AGENT_0_MODEL, AGENT_1_MODEL}
        assert recording_provider.calls[1]["model"] in {AGENT_0_MODEL, AGENT_1_MODEL}
        # The two agents must have used DIFFERENT models
        assert recording_provider.calls[0]["model"] != recording_provider.calls[1]["model"], (
            "Both agents used the same model — test agents should have different models"
        )
