"""
Tests for Hybrid Topic Guard — Phase 12 comprehensive test suite.

Coverage:
  A. Heuristic reject tests (no LLM call)
  B. Heuristic allow tests (fast path, no LLM call)
  C. Borderline → LLM pre-screen tests
  D. LLM allow tests (with context)
  E. LLM failure fallback tests
  F. Safety override tests
  G. Follow-up gate tests
  H. API integration tests (backward compat + new gate fields)

Also keeps backward-compat tests for legacy internals:
  - _deterministic_check
  - _is_ambiguous_deictic
  - _has_sufficient_context
  - CATEGORY_SUGGESTIONS
  - DebateStartRequest Pydantic validation
  - Cache behavior
  - TOPIC_GUARD_ENABLED=False
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.topic_guard.topic_guard_service import (
    CATEGORY_SUGGESTIONS,
    DebateTopicGuardService,
    TopicGateDecision,
    TopicGateResult,
    TopicValidationResult,
    _apply_safety_overrides,
    _deterministic_check,
    _has_deictic_type_only,
    _has_sufficient_context,
    _is_ambiguous_deictic,
    _is_self_contained_debate_topic,
    get_topic_guard,
    validate_followup_topic,
    validate_initial_topic,
)


# ═══════════════════════════════════════════════════════════════════════
# A. Heuristic Reject Tests (no LLM call)
# ═══════════════════════════════════════════════════════════════════════

class TestHeuristicReject:
    """Stage-1 deterministic rejections — no LLM should ever be called."""

    def _assert_reject(self, topic: str):
        result = _deterministic_check(topic)
        assert result is not None, f"Expected reject for: {topic!r}"
        assert result.is_valid is False
        assert result.source == "deterministic"

    # English pure deictic
    def test_is_this_right(self):          self._assert_reject("Is this right?")
    def test_is_this_correct(self):        self._assert_reject("Is this correct?")
    def test_is_this_okay(self):           self._assert_reject("Is this okay?")
    def test_is_it_correct(self):          self._assert_reject("Is it correct?")
    def test_is_that_true(self):           self._assert_reject("Is that true?")
    def test_does_this_work(self):         self._assert_reject("Does this work?")
    def test_will_this_work(self):         self._assert_reject("Will this work?")
    def test_thoughts(self):               self._assert_reject("Thoughts?")
    def test_any_thoughts(self):           self._assert_reject("Any thoughts?")
    def test_what_do_you_think(self):      self._assert_reject("What do you think?")
    def test_can_you_judge_this(self):     self._assert_reject("Can you judge this?")
    def test_does_above_make_sense(self):  self._assert_reject("Does the above make sense?")
    def test_is_my_idea_okay(self):        self._assert_reject("Is my idea okay?")
    def test_would_this_be_acceptable(self): self._assert_reject("Would this be acceptable?")

    # Russian pure deictic
    def test_ru_eto_pravilno(self):        self._assert_reject("Это правильно?")
    def test_ru_eto_normalno(self):        self._assert_reject("Это нормально?")
    def test_ru_eto_pravilno_ili_net(self): self._assert_reject("Это правильно или нет?")
    def test_ru_norm(self):                self._assert_reject("Норм?")
    def test_ru_kak_dumaesh(self):         self._assert_reject("Как думаешь?")
    def test_ru_mozhno_tak(self):          self._assert_reject("Можно так?")
    def test_ru_normalnoe_reshenie(self):   self._assert_reject("Это нормальное решение?")

    # Korean pure deictic
    def test_ko_igeo_macha(self):          self._assert_reject("이거 맞아?")
    def test_ko_eottae(self):              self._assert_reject("어때?")
    def test_ko_igeo_gwaenchana(self):     self._assert_reject("이거 괜찮아?")

    # Greetings
    def test_hi(self):                     self._assert_reject("hi")
    def test_hello(self):                  self._assert_reject("hello")
    def test_privet(self):                 self._assert_reject("привет")
    def test_annyeong(self):
        # "안녕" is 2 chars — caught by length check
        result = _deterministic_check("안녕")
        assert result is not None
        assert result.is_valid is False

    # Nonsense
    def test_empty(self):                  self._assert_reject("  ")
    def test_digits(self):                 self._assert_reject("12345")
    def test_punctuation(self):            self._assert_reject("????")
    def test_emoji_only(self):             self._assert_reject("🔥🔥🔥")
    def test_korean_emoticon(self):        self._assert_reject("ㅋㅋㅋㅋ")
    def test_keyboard_mash(self):          self._assert_reject("asdfghjkl zxcvbnm")

    def test_needs_clarification_category(self):
        result = _deterministic_check("Is this right?")
        assert result is not None
        assert result.category == "needs_clarification"

    def test_greeting_category(self):
        result = _deterministic_check("hello")
        assert result is not None
        assert result.category == "greeting"

    def test_nonsense_category(self):
        result = _deterministic_check("????")
        assert result is not None
        assert result.category == "nonsense"


# ═══════════════════════════════════════════════════════════════════════
# B. Heuristic Allow Tests (fast path, no LLM)
# ═══════════════════════════════════════════════════════════════════════

class TestHeuristicAllow:
    """Clearly self-contained topics pass immediately without LLM."""

    def _assert_allow(self, topic: str):
        result = _deterministic_check(topic)
        assert result is None, f"Deterministic should not reject: {topic!r}"
        assert _is_self_contained_debate_topic(topic) is True, \
            f"Expected self-contained: {topic!r}"

    def test_policy_question_ai(self):
        self._assert_allow("Should governments regulate high-risk AI?")

    def test_policy_question_short(self):
        self._assert_allow("Is AI dangerous?")

    def test_policy_question_taxes(self):
        self._assert_allow("Should taxes increase for the wealthy?")

    def test_policy_question_universities(self):
        self._assert_allow("Should universities ban AI-generated homework?")

    def test_evaluate_claim_en(self):
        self._assert_allow(
            "Evaluate this claim: strict AI regulation is necessary but may "
            "strengthen large technology companies."
        )

    def test_proverkh_argument_ru(self):
        self._assert_allow(
            "Проверь этот аргумент: строгая регуляция high-risk AI нужна, "
            "но может усилить Big Tech."
        )

    def test_deictic_with_fastapi_content(self):
        self._assert_allow(
            "Is this architecture correct? Backend uses FastAPI, PostgreSQL, "
            "WebSocket streaming, and Zustand."
        )

    def test_deictic_with_code(self):
        self._assert_allow(
            "Is this code secure: SELECT * FROM users WHERE id = ${userInput}"
        )

    def test_deictic_with_backend_details(self):
        self._assert_allow(
            "Is this design good? The backend stores debate turns in PostgreSQL "
            "and emits WebSocket events."
        )

    def test_no_deictic_domain_topic(self):
        self._assert_allow("Is remote work better than office work?")

    def test_is_ai_dangerous(self):
        assert _is_self_contained_debate_topic("Is AI dangerous?") is True

    def test_should_ai_be_banned(self):
        assert _is_self_contained_debate_topic("Should AI be banned?") is True

    def test_are_social_media_harmful(self):
        assert _is_self_contained_debate_topic(
            "Are social media platforms harmful to teenagers?"
        ) is True


# ═══════════════════════════════════════════════════════════════════════
# C. Borderline → LLM Pre-Screen Tests
# ═══════════════════════════════════════════════════════════════════════

class TestBorderlineLLM:
    """
    Borderline inputs pass Stage 1 (not rejected) but are not fast-allowed;
    they go to LLM pre-screening.
    """

    def _assert_borderline(self, topic: str):
        """Deterministic check passes (None) and fast-allow fails."""
        det = _deterministic_check(topic)
        assert det is None, f"Stage 1 should not reject: {topic!r}"
        assert _is_self_contained_debate_topic(topic) is False, \
            f"Should NOT be fast-allowed: {topic!r}"

    def test_is_this_design_good(self):
        self._assert_borderline("Is this design good?")

    def test_is_this_approach_valid(self):
        self._assert_borderline("Is this approach valid?")

    def test_would_this_approach_work(self):
        self._assert_borderline("Would this approach work?")

    def test_is_my_plan_reasonable(self):
        self._assert_borderline("Is my plan reasonable?")

    def test_can_you_evaluate_this_solution(self):
        self._assert_borderline("Can you evaluate this solution?")

    def test_is_this_implementation_okay(self):
        self._assert_borderline("Is this implementation okay?")

    def test_ru_eto_khoroshee_reshenie(self):
        self._assert_borderline("Это хорошее решение?")

    def test_ru_mozhno_tak_sdelat(self):
        self._assert_borderline("Можно так сделать?")

    def test_ko_i_bangyang_gwaenchana(self):
        self._assert_borderline("이 방향 괜찮아?")

    @pytest.mark.asyncio
    async def test_borderline_calls_llm(self):
        """Borderline inputs must trigger LLM pre-screening."""
        guard = DebateTopicGuardService()
        guard._cache.clear()

        llm_response = json.dumps({
            "decision": "needs_clarification",
            "reason_code": "missing_design_context",
            "user_message": "Please describe the design.",
            "confidence": 0.90,
        })
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content=llm_response))

        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ), patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_ENABLED = True
            mock_settings.TOPIC_GUARD_TIMEOUT_S = 4.0
            mock_settings.TOPIC_GUARD_MAX_TOKENS = 300
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            mock_settings.LLM_PROVIDER = "openrouter"
            mock_settings.TOPIC_GUARD_MODEL = "google/gemini-flash-1.5"
            mock_settings.TOPIC_GUARD_CACHE_TTL_S = 3600

            result = await guard.validate("Is this design good?")

        assert mock_llm.generate.call_count == 1
        assert result.should_start_debate is False
        assert result.decision == TopicGateDecision.needs_clarification
        assert result.source in ("llm", "heuristic")  # safety override may change source


# ═══════════════════════════════════════════════════════════════════════
# D. LLM Allow Tests (borderline with context)
# ═══════════════════════════════════════════════════════════════════════

class TestLLMAllow:
    """Inputs that heuristic fast-allows due to sufficient content."""

    def test_deictic_plus_fastapi_postgresql(self):
        topic = "Is this design good? Backend uses FastAPI, PostgreSQL, and WebSocket streaming."
        assert _is_self_contained_debate_topic(topic) is True

    def test_deictic_plus_redis_pubsub(self):
        topic = "Would this approach work? We use Redis pub/sub for live events and PostgreSQL for persistence."
        assert _is_self_contained_debate_topic(topic) is True

    @pytest.mark.asyncio
    async def test_llm_returns_debate_ready(self):
        guard = DebateTopicGuardService()
        guard._cache.clear()

        llm_response = json.dumps({
            "decision": "debate_ready",
            "reason_code": "self_contained_design_context",
            "user_message": "",
            "confidence": 0.92,
        })
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content=llm_response))

        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ), patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_ENABLED = True
            mock_settings.TOPIC_GUARD_TIMEOUT_S = 4.0
            mock_settings.TOPIC_GUARD_MAX_TOKENS = 300
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            mock_settings.LLM_PROVIDER = "openrouter"
            mock_settings.TOPIC_GUARD_MODEL = "google/gemini-flash-1.5"
            mock_settings.TOPIC_GUARD_CACHE_TTL_S = 3600

            # Topic with 2+ concrete nouns so safety override does NOT block it
            topic = "Is this backend design going to scale with Redis and PostgreSQL?"
            result = await guard.validate(topic)

        assert result.decision == TopicGateDecision.debate_ready
        assert result.should_start_debate is True


# ═══════════════════════════════════════════════════════════════════════
# E. LLM Failure Fallback Tests
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture()
def guard_fresh():
    guard = DebateTopicGuardService()
    guard._cache.clear()
    return guard


class TestLLMFailureFallback:

    @pytest.mark.asyncio
    async def test_timeout_short_ambiguous(self, guard_fresh):
        """Timeout on short ambiguous input → needs_clarification (fail-safe)."""
        import asyncio as real_asyncio

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content="{}"))

        with patch("app.services.topic_guard.topic_guard_service.asyncio") as mock_asyncio:
            mock_asyncio.wait_for = AsyncMock(side_effect=real_asyncio.TimeoutError())
            mock_asyncio.TimeoutError = real_asyncio.TimeoutError
            with patch(
                "app.services.topic_guard.topic_guard_service.get_llm_service",
                return_value=mock_llm,
            ):
                result = await guard_fresh._prescreen_with_llm("Is this design good?")

        assert result.source == "fallback"
        # Short ambiguous → needs_clarification
        assert result.decision == TopicGateDecision.needs_clarification

    @pytest.mark.asyncio
    async def test_timeout_long_substantial(self, guard_fresh):
        """Timeout on long substantial input → debate_ready (fail-open)."""
        import asyncio as real_asyncio
        long_topic = "Should governments impose strict regulations on high-risk AI systems " \
                     "to prevent misuse and protect civil liberties? Consider economic impact."

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content="{}"))

        with patch("app.services.topic_guard.topic_guard_service.asyncio") as mock_asyncio:
            mock_asyncio.wait_for = AsyncMock(side_effect=real_asyncio.TimeoutError())
            mock_asyncio.TimeoutError = real_asyncio.TimeoutError
            with patch(
                "app.services.topic_guard.topic_guard_service.get_llm_service",
                return_value=mock_llm,
            ):
                result = await guard_fresh._prescreen_with_llm(long_topic)

        assert result.source == "fallback"
        assert result.decision == TopicGateDecision.debate_ready

    @pytest.mark.asyncio
    async def test_exception_is_fallback(self, guard_fresh):
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("connection refused"))
        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ):
            result = await guard_fresh._prescreen_with_llm("Should AI replace teachers?")
        assert result.source == "fallback"
        assert result.should_start_debate is True  # long topic → fail-open

    @pytest.mark.asyncio
    async def test_malformed_json_is_fallback(self, guard_fresh):
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(
            return_value=MagicMock(content="this is not json at all")
        )
        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ):
            result = await guard_fresh._llm_classify("Should AI replace teachers?")
        assert result.source == "fallback"
        assert result.should_start_debate is True

    @pytest.mark.asyncio
    async def test_markdown_fenced_json_parsed(self, guard_fresh):
        inner = json.dumps({
            "decision": "needs_clarification",
            "reason_code": "not_debatable",
            "user_message": "Not a debatable topic.",
            "confidence": 0.9,
        })
        llm_content = f"```json\n{inner}\n```"
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content=llm_content))
        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ):
            result = await guard_fresh._llm_classify("What is gravity?")
        assert result.source == "llm"
        assert result.decision == TopicGateDecision.needs_clarification


# ═══════════════════════════════════════════════════════════════════════
# F. Safety Override Tests
# ═══════════════════════════════════════════════════════════════════════

class TestSafetyOverrides:

    def _make_llm_debate_ready(self, confidence: float = 0.9) -> TopicGateResult:
        return TopicGateResult(
            decision=TopicGateDecision.debate_ready,
            reason_code="llm_approved",
            user_message="",
            confidence=confidence,
            source="llm",
            should_start_debate=True,
        )

    def test_deictic_type_without_content_overridden(self):
        """LLM says debate_ready for 'Is this design good?' → override to needs_clarification."""
        llm_result = self._make_llm_debate_ready()
        final = _apply_safety_overrides("Is this design good?", llm_result)
        assert final.decision == TopicGateDecision.needs_clarification
        assert final.reason_code == "missing_object_context"
        assert final.should_start_debate is False

    def test_deictic_code_without_content_overridden(self):
        llm_result = self._make_llm_debate_ready()
        final = _apply_safety_overrides("Is this code secure?", llm_result)
        assert final.decision == TopicGateDecision.needs_clarification

    def test_deictic_architecture_without_content_overridden(self):
        llm_result = self._make_llm_debate_ready()
        final = _apply_safety_overrides("Is this architecture correct?", llm_result)
        assert final.decision == TopicGateDecision.needs_clarification

    def test_deictic_approach_without_content_overridden(self):
        llm_result = self._make_llm_debate_ready()
        final = _apply_safety_overrides("Is this approach valid?", llm_result)
        assert final.decision == TopicGateDecision.needs_clarification

    def test_low_confidence_overridden(self):
        """LLM says debate_ready with low confidence → override to needs_clarification."""
        llm_result = self._make_llm_debate_ready(confidence=0.60)  # below 0.75
        with patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            final = _apply_safety_overrides(
                "Should governments regulate high-risk AI?", llm_result
            )
        assert final.decision == TopicGateDecision.needs_clarification
        assert final.reason_code == "low_confidence"

    def test_high_confidence_passes(self):
        """LLM says debate_ready with high confidence for clear topic → passes through."""
        llm_result = self._make_llm_debate_ready(confidence=0.94)
        with patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            final = _apply_safety_overrides(
                "Should governments regulate high-risk AI?", llm_result
            )
        assert final.decision == TopicGateDecision.debate_ready
        assert final.should_start_debate is True

    def test_deictic_with_content_not_overridden(self):
        """Deictic + actual content → LLM debate_ready is NOT overridden."""
        topic = "Is this design good? Backend uses FastAPI, PostgreSQL, and WebSocket."
        llm_result = self._make_llm_debate_ready(confidence=0.92)
        with patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            final = _apply_safety_overrides(topic, llm_result)
        # Has 2+ concrete nouns → sufficient context → not overridden
        assert final.decision == TopicGateDecision.debate_ready

    def test_attachments_override_needs_clarification(self):
        """With attachments, needs_clarification for deictic type → debate_ready."""
        llm_result = TopicGateResult(
            decision=TopicGateDecision.needs_clarification,
            reason_code="missing_design_context",
            user_message="Please describe the design.",
            confidence=0.90,
            source="llm",
            should_start_debate=False,
        )
        final = _apply_safety_overrides("Is this design good?", llm_result, has_attachments=True)
        assert final.decision == TopicGateDecision.debate_ready
        assert final.reason_code == "context_from_attachments"


# ═══════════════════════════════════════════════════════════════════════
# G. Follow-up Gate Tests
# ═══════════════════════════════════════════════════════════════════════

class TestFollowupGate:

    def test_with_context_why_allowed(self):
        r = validate_followup_topic("Why?", has_previous_context=True)
        assert r.should_start_debate is True
        assert r.decision == TopicGateDecision.debate_ready

    def test_with_context_is_this_correct_allowed(self):
        r = validate_followup_topic("Is this correct?", has_previous_context=True)
        assert r.should_start_debate is True

    def test_with_context_can_you_simplify_allowed(self):
        r = validate_followup_topic("Can you simplify?", has_previous_context=True)
        assert r.should_start_debate is True

    def test_with_context_what_about_startups(self):
        r = validate_followup_topic("What about startups?", has_previous_context=True)
        assert r.should_start_debate is True

    def test_with_context_explain_more(self):
        r = validate_followup_topic("Explain more.", has_previous_context=True)
        assert r.should_start_debate is True

    def test_with_context_ru_pochemu(self):
        r = validate_followup_topic("А почему?", has_previous_context=True)
        assert r.should_start_debate is True

    def test_empty_rejected(self):
        r = validate_followup_topic("", has_previous_context=True)
        assert r.should_start_debate is False
        assert r.decision == TopicGateDecision.unsupported_or_empty

    def test_whitespace_rejected(self):
        r = validate_followup_topic("   ", has_previous_context=True)
        assert r.should_start_debate is False

    def test_punctuation_only_rejected(self):
        r = validate_followup_topic("?", has_previous_context=True)
        assert r.should_start_debate is False

    def test_emoji_only_rejected(self):
        r = validate_followup_topic("🔥", has_previous_context=True)
        assert r.should_start_debate is False

    def test_greeting_rejected(self):
        r = validate_followup_topic("привет", has_previous_context=True)
        assert r.should_start_debate is False
        assert r.decision == TopicGateDecision.smalltalk_or_greeting

    def test_hello_rejected(self):
        r = validate_followup_topic("hello", has_previous_context=True)
        assert r.should_start_debate is False

    def test_without_context_ambiguous_rejected(self):
        """Short ambiguous follow-up without prior context → needs_clarification."""
        r = validate_followup_topic("Is this correct?", has_previous_context=False)
        assert r.should_start_debate is False
        assert r.decision == TopicGateDecision.needs_clarification

    def test_without_context_substantive_allowed(self):
        """Substantive follow-up even without prior context can be allowed."""
        r = validate_followup_topic(
            "Should governments regulate AI in healthcare?",
            has_previous_context=False,
        )
        assert r.should_start_debate is True


# ═══════════════════════════════════════════════════════════════════════
# Backward-compat: legacy internal function tests
# ═══════════════════════════════════════════════════════════════════════

class TestDeterministicCheck:
    """Unit tests for _deterministic_check() — no LLM involved."""

    def test_empty_string(self):
        result = _deterministic_check("   ")
        assert result is not None
        assert result.is_valid is False
        assert result.source == "deterministic"

    def test_single_char(self):
        result = _deterministic_check("a")
        assert result is not None
        assert result.is_valid is False

    def test_two_chars(self):
        result = _deterministic_check("hi")
        assert result is not None
        assert result.is_valid is False

    def test_only_digits(self):
        result = _deterministic_check("12345")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "nonsense"

    def test_only_punctuation(self):
        result = _deterministic_check("????")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "nonsense"

    def test_only_emoji(self):
        result = _deterministic_check("🔥🔥🔥")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "nonsense"

    def test_greeting_hello(self):
        result = _deterministic_check("hello")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "greeting"

    def test_greeting_hey(self):
        result = _deterministic_check("hey!")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "greeting"

    def test_greeting_russian_privet(self):
        result = _deterministic_check("привет")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "greeting"

    def test_test_string(self):
        result = _deterministic_check("test")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "greeting"

    def test_korean_emoticon_kkk(self):
        result = _deterministic_check("ㅋㅋㅋㅋ")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "nonsense"

    def test_excessive_repeat(self):
        result2 = _deterministic_check("aaaaaa what")
        assert result2 is not None
        assert result2.is_valid is False

    def test_keyboard_mash_latin(self):
        result = _deterministic_check("asdfghjkl zxcvbnm")
        assert result is not None
        assert result.is_valid is False
        assert result.category == "nonsense"

    def test_ok_string(self):
        result = _deterministic_check("ok")
        assert result is not None
        assert result.is_valid is False

    def test_lol_string(self):
        result = _deterministic_check("lol")
        assert result is not None
        assert result.is_valid is False

    # Should NOT be rejected by Stage 1 (returns None)
    def test_valid_short_english(self):
        result = _deterministic_check("Should AI replace teachers?")
        assert result is None

    def test_valid_short_with_ai(self):
        result = _deterministic_check("Should AI be banned?")
        assert result is None

    def test_valid_russian_question(self):
        result = _deterministic_check(
            "Стоит ли университетам разрешать студентам использовать AI?"
        )
        assert result is None

    def test_valid_korean_question(self):
        result = _deterministic_check("고위험 AI를 정부가 강하게 규제해야 하는가?")
        assert result is None

    def test_valid_remote_work(self):
        result = _deterministic_check("Is remote work better than office work?")
        assert result is None

    def test_valid_long_question(self):
        result = _deterministic_check(
            "Should governments impose strict regulations on high-risk AI systems "
            "to prevent misuse and protect civil liberties?"
        )
        assert result is None

    def test_does_not_reject_word_ai_in_sentence(self):
        result = _deterministic_check("Should AI be regulated by governments?")
        assert result is None


class TestDeicticAmbiguity:
    """Tests for deictic/ambiguous reference detection."""

    def test_is_this_right(self):     assert _is_ambiguous_deictic("Is this right?") is True
    def test_is_this_correct(self):   assert _is_ambiguous_deictic("Is this correct?") is True
    def test_is_it_correct(self):     assert _is_ambiguous_deictic("Is it correct?") is True
    def test_is_this_okay(self):      assert _is_ambiguous_deictic("Is this okay?") is True
    def test_is_that_true(self):      assert _is_ambiguous_deictic("Is that true?") is True
    def test_does_this_work(self):    assert _is_ambiguous_deictic("Does this work?") is True
    def test_will_this_work(self):    assert _is_ambiguous_deictic("Will this work?") is True
    def test_thoughts(self):          assert _is_ambiguous_deictic("Thoughts?") is True
    def test_any_thoughts(self):      assert _is_ambiguous_deictic("Any thoughts?") is True
    def test_makes_sense(self):       assert _is_ambiguous_deictic("Makes sense?") is True
    def test_ru_eto_pravilno(self):   assert _is_ambiguous_deictic("Это правильно?") is True
    def test_ru_norm(self):           assert _is_ambiguous_deictic("Норм?") is True
    def test_ko_igeo_macha(self):     assert _is_ambiguous_deictic("이거 맞아?") is True
    def test_ko_eottae(self):         assert _is_ambiguous_deictic("어때?") is True

    # Should NOT be ambiguous (allow)
    def test_no_deictic_ai(self):
        assert _is_ambiguous_deictic("Should AI be regulated by governments?") is False

    def test_no_deictic_remote_work(self):
        assert _is_ambiguous_deictic("Is remote work better than office work?") is False

    def test_no_deictic_docker(self):
        assert _is_ambiguous_deictic("Is Docker necessary for backend development?") is False

    def test_deictic_with_two_concrete_nouns(self):
        """Deictic + two concrete nouns = sufficient context → not ambiguous."""
        assert _is_ambiguous_deictic(
            "Is this backend design correct? Using FastAPI and PostgreSQL."
        ) is False

    def test_long_question_with_deictic(self):
        long_q = (
            "Is this architecture correct? The backend uses FastAPI with async SQLAlchemy, "
            "PostgreSQL, and Redis for caching."
        )
        assert _is_ambiguous_deictic(long_q) is False

    def test_deictic_with_colon_context(self):
        assert _is_ambiguous_deictic("Is this correct: def foo(): return 1 + 1") is False


class TestHasSufficientContext:
    """Tests for _has_sufficient_context()."""

    def test_short_bare_question_insufficient(self):
        assert _has_sufficient_context("Is this right?") is False

    def test_long_question_sufficient(self):
        long_q = "Is this architecture scalable enough for a system with 10k concurrent users "
        assert _has_sufficient_context(long_q + "using FastAPI and PostgreSQL?") is True

    def test_colon_context_sufficient(self):
        assert _has_sufficient_context("Is this correct: SELECT * FROM users") is True

    def test_code_block_sufficient(self):
        assert _has_sufficient_context("Is this right?\n```python\ndef f(): pass```") is True

    def test_two_concrete_nouns_sufficient(self):
        """Two concrete nouns from the set → sufficient."""
        assert _has_sufficient_context("Is this backend architecture correct?") is True

    def test_single_noun_design_insufficient(self):
        """Single concrete noun 'design' alone → NOT sufficient (changed behavior)."""
        assert _has_sufficient_context("Is this design fine?") is False

    def test_single_noun_code_insufficient(self):
        assert _has_sufficient_context("Is this code secure?") is False

    def test_no_context_cues_insufficient(self):
        assert _has_sufficient_context("Is it okay?") is False


class TestHasDeicticTypeOnly:
    """Tests for the safety override helper."""

    def test_design_without_content(self):
        assert _has_deictic_type_only("Is this design good?") is True

    def test_code_without_content(self):
        assert _has_deictic_type_only("Is this code secure?") is True

    def test_architecture_without_content(self):
        assert _has_deictic_type_only("Is this architecture correct?") is True

    def test_approach_without_content(self):
        assert _has_deictic_type_only("Is this approach valid?") is True

    def test_design_with_content_not_flagged(self):
        topic = "Is this design correct? Using FastAPI, PostgreSQL, and WebSocket."
        assert _has_deictic_type_only(topic) is False

    def test_no_deictic_not_flagged(self):
        assert _has_deictic_type_only("Should AI be regulated?") is False


# ═══════════════════════════════════════════════════════════════════════
# Cache tests (backward compat)
# ═══════════════════════════════════════════════════════════════════════

class TestCache:

    @pytest.mark.asyncio
    async def test_second_call_uses_cache(self, guard_fresh):
        llm_response = json.dumps({
            "decision": "debate_ready",
            "reason_code": "valid",
            "user_message": "",
            "confidence": 0.9,
        })
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content=llm_response))

        # Deictic topic that: passes Stage 1, is NOT fast-allowed by heuristic,
        # does NOT trigger safety override → goes to LLM, result cached.
        topic = "Is this better for production environments with strict SLAs?"

        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ), patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_ENABLED = True
            mock_settings.TOPIC_GUARD_TIMEOUT_S = 4.0
            mock_settings.TOPIC_GUARD_MAX_TOKENS = 300
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            mock_settings.LLM_PROVIDER = "openrouter"
            mock_settings.TOPIC_GUARD_MODEL = "google/gemini-flash-1.5"
            mock_settings.TOPIC_GUARD_CACHE_TTL_S = 3600

            result1 = await guard_fresh.validate(topic)
            result2 = await guard_fresh.validate(topic)

        assert result1.should_start_debate is True
        assert result2.source == "cache"
        # If Stage 2 reached, LLM called once; if fast-allowed, LLM not called at all
        assert mock_llm.generate.call_count <= 1

    @pytest.mark.asyncio
    async def test_cache_normalizes_whitespace(self, guard_fresh):
        llm_response = json.dumps({
            "decision": "debate_ready",
            "reason_code": "valid",
            "user_message": "",
            "confidence": 0.9,
        })
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=MagicMock(content=llm_response))

        # Use a borderline topic that will reach LLM
        topic_a = "Is this approach going to scale properly?"
        topic_b = "Is  this  approach  going  to  scale  properly?"  # extra spaces

        with patch(
            "app.services.topic_guard.topic_guard_service.get_llm_service",
            return_value=mock_llm,
        ), patch(
            "app.services.topic_guard.topic_guard_service.settings",
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_ENABLED = True
            mock_settings.TOPIC_GUARD_TIMEOUT_S = 4.0
            mock_settings.TOPIC_GUARD_MAX_TOKENS = 300
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            mock_settings.LLM_PROVIDER = "openrouter"
            mock_settings.TOPIC_GUARD_MODEL = "google/gemini-flash-1.5"
            mock_settings.TOPIC_GUARD_CACHE_TTL_S = 3600

            await guard_fresh.validate(topic_a)
            result2 = await guard_fresh.validate(topic_b)

        assert result2.source == "cache"
        assert mock_llm.generate.call_count == 1


# ═══════════════════════════════════════════════════════════════════════
# TOPIC_GUARD_ENABLED=False
# ═══════════════════════════════════════════════════════════════════════

class TestGuardDisabled:

    @pytest.mark.asyncio
    async def test_guard_disabled_passes_through(self):
        guard = DebateTopicGuardService()
        with patch(
            "app.services.topic_guard.topic_guard_service.settings"
        ) as mock_settings:
            mock_settings.TOPIC_GUARD_ENABLED = False
            mock_settings.TOPIC_GUARD_CACHE_TTL_S = 3600
            mock_settings.TOPIC_GUARD_MIN_CONFIDENCE = 0.75
            result = await guard.validate("What is Python?")

        assert result.should_start_debate is True
        assert result.source == "fallback"


# ═══════════════════════════════════════════════════════════════════════
# Category suggestions
# ═══════════════════════════════════════════════════════════════════════

class TestCategorySuggestions:

    def test_greeting_has_suggestions(self):
        assert len(CATEGORY_SUGGESTIONS.get("greeting", [])) > 0

    def test_nonsense_has_suggestions(self):
        assert len(CATEGORY_SUGGESTIONS.get("nonsense", [])) > 0

    def test_too_broad_has_suggestions(self):
        assert len(CATEGORY_SUGGESTIONS.get("too_broad", [])) > 0

    def test_unsafe_has_empty_suggestions(self):
        assert CATEGORY_SUGGESTIONS.get("unsafe", []) == []


# ═══════════════════════════════════════════════════════════════════════
# Pydantic-level DebateStartRequest validation
# ═══════════════════════════════════════════════════════════════════════

class TestDebateStartRequestValidation:

    def test_empty_question_raises(self):
        from pydantic import ValidationError
        from app.schemas.debate import DebateStartRequest
        with pytest.raises(ValidationError) as exc_info:
            DebateStartRequest(question="   ", agents=[{"role": "Analyst"}])
        errors = exc_info.value.errors()
        assert any("empty" in str(e).lower() for e in errors)

    def test_too_long_question_raises(self):
        from pydantic import ValidationError
        from app.schemas.debate import DebateStartRequest
        with pytest.raises(ValidationError) as exc_info:
            DebateStartRequest(question="a" * 2001, agents=[{"role": "Analyst"}])
        errors = exc_info.value.errors()
        assert any("too long" in str(e).lower() or "2000" in str(e) for e in errors)

    def test_valid_question_passes(self):
        from app.schemas.debate import DebateStartRequest
        req = DebateStartRequest(
            question="Should AI be regulated by governments?",
            agents=[{"role": "Analyst"}],
        )
        assert req.question == "Should AI be regulated by governments?"

    def test_question_is_stripped(self):
        from app.schemas.debate import DebateStartRequest
        req = DebateStartRequest(
            question="  Should AI be regulated?  ",
            agents=[{"role": "Analyst"}],
        )
        assert req.question == "Should AI be regulated?"


# ═══════════════════════════════════════════════════════════════════════
# H. API Integration Tests
# ═══════════════════════════════════════════════════════════════════════

def _debate_payload(question: str, num_agents: int = 2) -> dict:
    roles = ["Analyst", "Critic"]
    return {
        "question": question,
        "agents": [{"role": roles[i % len(roles)]} for i in range(num_agents)],
    }


class TestAPIIntegration:
    """
    Tests the /debates/start endpoint with the topic guard active.
    """

    @pytest.mark.asyncio
    async def test_greeting_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("hello"))
        assert resp.status_code == 422
        body = resp.json()
        detail = body["detail"]
        assert detail["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_random_chars_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("asdfghjkl zxcvbnm"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_emoji_only_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("🔥🔥🔥"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_digits_only_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("12345"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_punctuation_only_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("????"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_russian_greeting_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("привет"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_korean_emoticon_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("ㅋㅋㅋㅋ"))
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_empty_question_returns_422_pydantic(self, client):
        resp = await client.post("/debates/start", json=_debate_payload(""))
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body

    @pytest.mark.asyncio
    async def test_invalid_topic_does_not_create_debate(self, client, db_session):
        from sqlalchemy import select
        from app.models.chat_session import ChatSession

        resp2 = await client.post("/debates/start", json=_debate_payload("hello"))
        assert resp2.status_code == 422
        assert resp2.json()["detail"]["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_422_response_includes_gate_object(self, client):
        """422 response must include the new gate object."""
        resp = await client.post("/debates/start", json=_debate_payload("hello"))
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert "gate" in detail
        gate = detail["gate"]
        assert "decision" in gate
        assert "reason_code" in gate
        assert "user_message" in gate
        assert "confidence" in gate
        assert "source" in gate

    @pytest.mark.asyncio
    async def test_422_response_includes_suggestions(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("hello"))
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert "suggestions" in detail
        assert isinstance(detail["suggestions"], list)

    @pytest.mark.asyncio
    async def test_422_response_structure(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("привет"))
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "INVALID_DEBATE_TOPIC"
        assert "category" in detail
        assert "message" in detail
        assert "reason" in detail
        assert "suggested_topic" in detail
        assert "suggestions" in detail

    @pytest.mark.asyncio
    async def test_valid_english_topic_returns_201(self, client):
        resp = await client.post(
            "/debates/start",
            json=_debate_payload("Should AI be regulated by governments?"),
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_valid_russian_topic_returns_201(self, client):
        resp = await client.post(
            "/debates/start",
            json=_debate_payload(
                "Стоит ли университетам разрешать студентам использовать AI?"
            ),
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_valid_korean_topic_returns_201(self, client):
        resp = await client.post(
            "/debates/start",
            json=_debate_payload("고위험 AI를 정부가 강하게 규제해야 하는가?"),
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_guard_does_not_block_rag_retrieval(self, client):
        """Topics with a concrete claim and RAG context should pass."""
        resp = await client.post(
            "/debates/start",
            json=_debate_payload(
                "Evaluate this claim: strict AI regulation is necessary but may "
                "strengthen large technology companies."
            ),
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_pure_deictic_returns_422(self, client):
        """'Is this right?' must return 422 needs_clarification."""
        resp = await client.post("/debates/start", json=_debate_payload("Is this right?"))
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "INVALID_DEBATE_TOPIC"
        gate = detail.get("gate", {})
        assert gate.get("decision") in (
            "needs_clarification", "unsupported_or_empty"
        )

    @pytest.mark.asyncio
    async def test_pure_deictic_ru_returns_422(self, client):
        resp = await client.post("/debates/start", json=_debate_payload("Это правильно?"))
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert detail["code"] == "INVALID_DEBATE_TOPIC"

    @pytest.mark.asyncio
    async def test_deictic_with_substantial_context_returns_201(self, client):
        """Deictic + actual content should start debate."""
        resp = await client.post(
            "/debates/start",
            json=_debate_payload(
                "Is this architecture correct? The backend uses FastAPI with async "
                "SQLAlchemy, PostgreSQL, and Redis for caching."
            ),
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_should_not_start_debate_before_gate_passes(self, client, db_session):
        """Gate rejection must not create DB records."""
        from sqlalchemy import select
        from app.models.chat_session import ChatSession

        before_count = len(
            (await db_session.execute(select(ChatSession))).scalars().all()
        )
        # This is a pure deictic — must be rejected
        resp = await client.post("/debates/start", json=_debate_payload("Is this right?"))
        assert resp.status_code == 422

        after_count = len(
            (await db_session.execute(select(ChatSession))).scalars().all()
        )
        assert after_count == before_count, "DB records must not be created on gate rejection"
