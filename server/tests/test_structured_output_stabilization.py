"""Tests for structured-output stabilization (Phase 9).

Covers the strict structured-output validator, simplified-field alias
acceptance in the normalizer, and exclusion of failed nodes from later-round
digests. These guard the invariants:
  * malformed / empty / fallback output is never treated as valid content,
  * placeholder / schema fragments are rejected,
  * failed nodes are dropped from downstream rounds,
  * old debates with legacy field names still render.
"""

from __future__ import annotations

import uuid

from app.schemas.contracts import AgentRoundResult
from app.services.debate_engine.quality_guards import validate_structured_output
from app.services.debate_engine.response_normalizer import (
    _apply_field_aliases,
    fallback_parse,
    normalize_round_output,
)
from app.services.debate_engine.round_manager import _build_round3_digest


def _agent_result(role: str, structured: dict, status: str = "success") -> AgentRoundResult:
    return AgentRoundResult(
        agent_id=uuid.uuid4(),
        role=role,
        content="{}",
        structured=structured,
        generation_status=status,
    )


# 1. Empty response is not accepted as valid.
def test_empty_response_is_rejected():
    reasons = validate_structured_output(
        {"response": ""}, round_number=1, round_type=None, raw_content=""
    )
    assert "empty_response" in reasons
    assert "missing_response_body" in reasons


# 2. Parse failure (truncated JSON) -> fallback payload -> rejected, can retry.
def test_truncated_json_fallback_is_rejected():
    normalized = normalize_round_output(
        round_number=1,
        raw_text='{"response": "partial answer that never clos',
    )
    assert normalized.payload.get("is_fallback") is True
    reasons = validate_structured_output(
        normalized.payload, round_number=1, round_type=None, raw_content="x" * 100
    )
    assert "json_parse_failed_used_text_fallback" in reasons


# 3. Placeholder / meta-process text triggers failure.
def test_placeholder_meta_text_is_rejected():
    payload = {
        "stance": "support",
        "response": "I need to create a JSON object that follows the output contract.",
    }
    reasons = validate_structured_output(
        payload, round_number=1, round_type=None, raw_content="x" * 100
    )
    assert "placeholder_output" in reasons


# 4. Leaked schema bullet "*: 523 words" is rejected.
def test_asterisk_word_count_bullet_is_rejected():
    payload = {
        "stance": "support",
        "response": "Here is the answer.\n*: 523 words\nMore text follows here too.",
    }
    reasons = validate_structured_output(
        payload, round_number=1, round_type=None, raw_content="x" * 100
    )
    assert "placeholder_output" in reasons


# 5. Numbered schema bullet "2*: Name the specific assumption..." is rejected.
def test_numbered_schema_bullet_is_rejected():
    payload = {
        "target_agent": "analyst",
        "challenge": "x",
        "counterargument": "y",
        "response": "2*: Name the specific assumption being attacked and why.",
    }
    reasons = validate_structured_output(
        payload, round_number=2, round_type="critique", raw_content="x" * 100
    )
    assert "placeholder_output" in reasons


# 6. Missing required Round 1 fields is rejected.
def test_missing_round1_required_fields():
    payload = {"response": "A perfectly readable answer with enough length to pass."}
    reasons = validate_structured_output(
        payload, round_number=1, round_type=None, raw_content="x" * 100
    )
    # No stance -> missing_required_fields.
    assert "missing_required_fields" in reasons


# 7. A clean Round 1 payload passes validation.
def test_clean_round1_payload_passes():
    payload = {
        "stance": "support",
        "main_argument": "A clear argument.",
        "response": "A perfectly readable answer with more than forty characters of content.",
        "is_fallback": False,
    }
    reasons = validate_structured_output(
        payload, round_number=1, round_type=None, raw_content="x" * 100
    )
    assert reasons == []


# 8. Failed Round 1 node is excluded from the Round 3 digest.
def test_failed_round1_excluded_from_round3_digest():
    good = _agent_result("analyst", {"stance": "support", "main_argument": "ok"})
    bad = _agent_result("critic", {}, status="failed")
    digest = _build_round3_digest(
        question="Q?",
        round1_results=[good, bad],
        round2_results=[],
    )
    roles = {item["agent"] for item in digest["round1"]}
    assert "analyst" in roles
    assert "critic" not in roles


# 9. Failed Round 2 node is excluded from the Round 3 digest.
def test_failed_round2_excluded_from_round3_digest():
    r1 = _agent_result("analyst", {"stance": "support", "main_argument": "ok"})
    good_r2 = _agent_result("analyst", {"counterargument": "valid critique"})
    bad_r2 = _agent_result("critic", {}, status="failed")
    digest = _build_round3_digest(
        question="Q?",
        round1_results=[r1],
        round2_results=[good_r2, bad_r2],
    )
    r2_roles = {item["agent"] for item in digest["round2"]}
    assert "analyst" in r2_roles
    assert "critic" not in r2_roles


# 10. Simplified field aliases map onto legacy canonical keys (old + new render).
def test_field_aliases_map_to_legacy_keys():
    payload = {
        "takeaway": "One clear sentence.",
        "supporting_points": ["a", "b"],
        "risks": ["risk one"],
        "consensus": "We agree on X.",
    }
    mapped = _apply_field_aliases(dict(payload))
    assert mapped["one_sentence_takeaway"] == "One clear sentence."
    assert mapped["key_points"] == ["a", "b"]
    assert mapped["risks_or_caveats"] == ["risk one"]
    assert mapped["consensus_statement"] == "We agree on X."
    # Original alias keys are preserved (non-destructive).
    assert mapped["takeaway"] == "One clear sentence."


def test_field_alias_does_not_overwrite_existing_canonical():
    payload = {
        "takeaway": "new",
        "one_sentence_takeaway": "existing legacy value",
    }
    mapped = _apply_field_aliases(dict(payload))
    assert mapped["one_sentence_takeaway"] == "existing legacy value"


def test_fallback_payload_marks_is_fallback():
    payload = fallback_parse("totally unparseable text", round_number=1)
    assert payload.payload.get("is_fallback") is True
