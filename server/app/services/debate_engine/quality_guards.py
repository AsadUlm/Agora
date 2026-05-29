"""Runtime quality + prompt-leak guards for debate round outputs.

This module is the single enforcement point that keeps debate output reading
like a panel of experts instead of an LLM narrating its own prompt. It works on
the *normalized* payload produced by ``response_normalizer`` — i.e. after JSON
parsing — and inspects only the **values** of user-facing fields, never the
schema key names themselves.

Four validators are exposed:

* :class:`PromptLeakValidator`      — rejects prompt / role / schema /
  formatting / meta-process text that leaked into user-facing content.
* :class:`ArgumentQualityValidator` — rejects vague, stance-less, or
  question-restating opening statements (Round 1).
* :class:`CritiqueQualityValidator` — rejects critiques that do not quote a
  claim or name the assumption being attacked (Round 2).
* :class:`SynthesisQualityValidator`— rejects neutral / hedging conclusions
  that lack a winning argument or a concrete recommendation (Round 3 + verdict).

The high-level entrypoint :func:`evaluate_round_quality` dispatches to the right
validators for a given round and returns a :class:`QualityReport`. Only prompt
leakage is treated as *regenerate-worthy* by callers (``report.has_leak``);
quality issues are surfaced for observability without forcing a costly retry,
to avoid over-rejecting otherwise valid debates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Fields whose VALUES are shown to the user and must stay clean ─────────────
# Only these field values are scanned. Schema key names are never scanned, so a
# field literally called ``one_sentence_takeaway`` is fine — what matters is
# that its *value* does not contain the phrase "one_sentence_takeaway".
_USER_FACING_FIELDS = (
    "response",
    "display_content",
    "main_argument",
    "one_sentence_takeaway",
    "short_summary",
    "stance",
    "challenge",
    "assumption_attacked",
    "why_it_breaks",
    "real_world_implication",
    "weakness_found",
    "counterargument",
    "final_position",
    "core_consensus",
    "policy_direction",
    "key_tradeoff",
    "winning_argument",
    "losing_argument",
    "what_changed",
    "position_shift",
    "strongest_argument",
    "remaining_concerns",
    "conclusion",
    "verdict",
    "summary",
)

_USER_FACING_LIST_FIELDS = (
    "key_points",
    "risks_or_caveats",
    "major_disagreements",
    "risk_tradeoffs",
    "unresolved_questions",
)

# ── Prompt / schema / role / formatting / meta-process leak patterns ──────────
# These match phrases that should only ever live in a prompt, never in an
# expert panelist's answer. Word boundaries / context keep false positives low.
_LEAK_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("leak_schema_field", re.compile(r"(?i)\b(one_sentence_takeaway|short_summary|key_points|risks_or_caveats|assumption_attacked|why_it_breaks|real_world_implication)\b")),
    ("leak_output_contract", re.compile(r"(?i)\boutput contract\b")),
    ("leak_json_schema", re.compile(r"(?i)\bjson (schema|object|format)\b")),
    ("leak_return_json", re.compile(r"(?i)\breturn only valid json\b")),
    ("leak_round_objective", re.compile(r"(?i)\bround\s*[1-9]?\s*objective\b")),
    ("leak_field_requirements", re.compile(r"(?i)\bfield (requirements|differentiation|list)\b")),
    ("leak_persona_meta", re.compile(r"(?i)\bmy persona\b")),
    ("leak_role_meta", re.compile(r"(?i)\b(my role is|my assigned role|i am (the )?(analyst|critic|creative|moderator)\b)")),
    ("leak_instructions", re.compile(r"(?i)\bthe (instructions?|prompt|contract|schema)\b[^.!?\n]{0,60}\b(say|state|require|ask|tell)")),
    ("leak_internal_reasoning", re.compile(r"(?i)\binternal reasoning\b")),
    ("leak_you_must_output", re.compile(r"(?i)\byou must (output|return|produce|provide)\b")),
    ("leak_meta_process", re.compile(r"(?im)\b(i need to|i'm going to|i will now|let me)\b[^.!?\n]{0,80}\b(json|schema|object|format|field|response|answer|statement|critique|synthesis)\b")),
    ("leak_as_an_ai", re.compile(r"(?i)\bas an ai\b")),
    ("leak_here_is_json", re.compile(r"(?i)\bhere(?:'s| is)\b[^.!?\n]{0,40}\b(the )?json\b")),
    ("leak_generating", re.compile(r"(?im)^\s*generating\b[^.!?\n]{0,60}\b(json|synthesis|object)\b")),
    ("leak_no_markdown", re.compile(r"(?i)\bdo not use markdown fences\b")),
)

# Phrases that signal an empty / non-committal stance (synthesis & opening).
_HEDGING_PATTERNS = tuple(
    re.compile(p)
    for p in (
        r"(?i)\bit depends\b",
        r"(?i)\bthere are (valid )?(points|arguments) on both sides\b",
        r"(?i)\bboth sides have merit\b",
        r"(?i)\bno clear (answer|winner|resolution)\b(?![^.!?]{0,40}because)",
        r"(?i)\bit('?s| is) hard to say\b",
        r"(?i)\bultimately (a matter of|subjective)\b",
    )
)


@dataclass(frozen=True)
class QualityIssue:
    """A single detected problem in a round output."""

    code: str
    message: str


@dataclass(frozen=True)
class QualityReport:
    """Aggregated result of running validators over one round payload."""

    issues: list[QualityIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    @property
    def has_leak(self) -> bool:
        return any(issue.code.startswith("leak_") for issue in self.issues)

    @property
    def leak_codes(self) -> list[str]:
        return [i.code for i in self.issues if i.code.startswith("leak_")]

    @property
    def summary(self) -> str:
        if not self.issues:
            return "ok"
        return "; ".join(f"{i.code}: {i.message}" for i in self.issues)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _collect_user_facing_text(payload: dict) -> str:
    """Concatenate the VALUES of user-facing fields into one scannable string."""
    parts: list[str] = []
    for key in _USER_FACING_FIELDS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value)
    for key in _USER_FACING_LIST_FIELDS:
        value = payload.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value if isinstance(item, str) and item.strip())
    return "\n".join(parts)


def _non_empty(payload: dict, key: str) -> bool:
    value = payload.get(key)
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(isinstance(i, str) and i.strip() for i in value)
    return False


def _word_count(text: str) -> int:
    return len(text.split())


# ── Validators ────────────────────────────────────────────────────────────────

class PromptLeakValidator:
    """Reject prompt / role / schema / formatting / meta-process leakage."""

    @staticmethod
    def validate(payload: dict) -> list[QualityIssue]:
        text = _collect_user_facing_text(payload)
        if not text:
            return []
        issues: list[QualityIssue] = []
        for code, pattern in _LEAK_PATTERNS:
            match = pattern.search(text)
            if match:
                snippet = match.group(0).strip()[:60]
                issues.append(QualityIssue(code, f"leaked prompt/meta text: '{snippet}'"))
        return issues


class ArgumentQualityValidator:
    """Round 1 opening-statement quality gate."""

    MIN_WORDS = 60

    @staticmethod
    def validate(payload: dict) -> list[QualityIssue]:
        issues: list[QualityIssue] = []
        response = payload.get("response") or payload.get("main_argument") or ""
        if isinstance(response, str) and _word_count(response) < ArgumentQualityValidator.MIN_WORDS:
            issues.append(
                QualityIssue(
                    "quality_too_short",
                    f"opening statement is too short ({_word_count(response)} words)",
                )
            )
        if not _non_empty(payload, "stance"):
            issues.append(QualityIssue("quality_no_stance", "no explicit stance"))
        if not (_non_empty(payload, "main_argument") or _non_empty(payload, "key_points")):
            issues.append(
                QualityIssue("quality_no_argument", "no main argument or key points")
            )
        return issues


class CritiqueQualityValidator:
    """Round 2 cross-examination quality gate."""

    @staticmethod
    def validate(payload: dict) -> list[QualityIssue]:
        issues: list[QualityIssue] = []
        # A real critique must reference a specific claim and the assumption.
        if not (_non_empty(payload, "challenge") or _non_empty(payload, "target_agent")):
            issues.append(
                QualityIssue("quality_no_target", "critique does not reference a specific claim")
            )
        if not _non_empty(payload, "assumption_attacked"):
            issues.append(
                QualityIssue(
                    "quality_no_assumption", "critique does not name the assumption attacked"
                )
            )
        if not (_non_empty(payload, "counterargument") or _non_empty(payload, "why_it_breaks")):
            issues.append(
                QualityIssue("quality_no_counter", "critique offers no counter-argument")
            )
        return issues


class SynthesisQualityValidator:
    """Round 3 / moderator-verdict synthesis quality gate."""

    @staticmethod
    def validate(payload: dict) -> list[QualityIssue]:
        issues: list[QualityIssue] = []
        if not (
            _non_empty(payload, "final_position")
            or _non_empty(payload, "conclusion")
            or _non_empty(payload, "verdict")
        ):
            issues.append(
                QualityIssue("quality_no_conclusion", "synthesis has no final position")
            )
        if not (
            _non_empty(payload, "winning_argument")
            or _non_empty(payload, "strongest_argument")
        ):
            issues.append(
                QualityIssue("quality_no_winner", "synthesis names no winning argument")
            )
        if not (
            _non_empty(payload, "policy_direction")
            or _non_empty(payload, "key_tradeoff")
            or _non_empty(payload, "conclusion")
        ):
            issues.append(
                QualityIssue("quality_no_recommendation", "synthesis gives no recommendation")
            )
        # Reject overtly neutral / hedging conclusions.
        decision_text = " ".join(
            str(payload.get(k) or "")
            for k in ("final_position", "conclusion", "verdict", "one_sentence_takeaway")
        )
        for pattern in _HEDGING_PATTERNS:
            if pattern.search(decision_text):
                issues.append(
                    QualityIssue("quality_neutral", "synthesis conclusion is neutral / hedging")
                )
                break
        return issues


# ── Dispatch ──────────────────────────────────────────────────────────────────

def evaluate_round_quality(
    round_number: int,
    round_type: str | None,
    payload: dict,
) -> QualityReport:
    """Run the prompt-leak guard plus the round-appropriate quality validator.

    ``round_type`` takes precedence over ``round_number`` so follow-up cycles
    and the moderator verdict route to the correct validator.
    """
    if not isinstance(payload, dict):
        return QualityReport()

    issues: list[QualityIssue] = list(PromptLeakValidator.validate(payload))

    dispatch = (round_type or "").lower()
    if dispatch in ("critique", "followup_critique") or round_number == 2:
        issues.extend(CritiqueQualityValidator.validate(payload))
    elif dispatch in ("final", "synthesis_verdict", "updated_synthesis") or round_number == 3:
        issues.extend(SynthesisQualityValidator.validate(payload))
    elif dispatch in ("initial", "followup_response") or round_number == 1:
        issues.extend(ArgumentQualityValidator.validate(payload))

    return QualityReport(issues=issues)


# ── Strict structured-output validation (Phase 2) ─────────────────────────────
# Detects payloads that parsed as JSON (or fell back) but whose user-facing
# content is malformed: empty, placeholder/schema fragments, or missing the
# fields a round needs to be displayable. Unlike the quality validators above,
# a positive result here is treated by callers as a hard failure that triggers
# retry / repair and ultimately marks the node as failed.

# Substrings that should never appear in user-facing content — they are schema
# instructions, example scaffolding, or meta-process text.
_MALFORMED_SUBSTRINGS: tuple[str, ...] = (
    "full multi-paragraph",
    "no meta-language",
    "output contract",
    "json schema",
    "i need to",
    "my persona",
    "name the specific assumption",
    "return only valid json",
    "<full",
    "<one complete sentence",
    "<point 1>",
    "<risk or caveat>",
    "<same sentence",
)

# Lines that look like leaked schema bullets, e.g. ``*: 523 words`` or
# ``2*: Name the specific assumption being attacked``.
_MALFORMED_LINE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*\d*\*\s*:"),          # "*: ..." / "2*: ..."
    re.compile(r"^\s*\d+\s*\*\s*:"),       # "2 *: ..."
    re.compile(r"(?i)^\s*perfect\.?\s*$"),  # bare "Perfect."
)

# Minimum displayable length for the main body.
_MIN_RESPONSE_CHARS = 40

# Required user-facing fields per round (at least one non-empty in each group).
_REQUIRED_FIELDS: dict[str, tuple[tuple[str, ...], ...]] = {
    "round1": (
        ("response", "main_argument"),
        ("stance",),
    ),
    "round2": (
        ("response", "counterargument"),
        ("target_agent", "challenge", "assumption_attacked"),
    ),
    "round3": (
        ("response", "conclusion", "final_position"),
    ),
    "synthesis_verdict": (
        ("response", "recommended_answer"),
    ),
}


def _has_malformed_fragments(text: str) -> bool:
    """True if ``text`` contains placeholder / schema / meta fragments."""
    if not text:
        return False
    lowered = text.lower()
    if any(token in lowered for token in _MALFORMED_SUBSTRINGS):
        return True
    for line in text.splitlines():
        for pattern in _MALFORMED_LINE_PATTERNS:
            if pattern.search(line):
                return True
    return False


def _required_groups_for(round_number: int, round_type: str | None) -> tuple[tuple[str, ...], ...]:
    dispatch = (round_type or "").lower()
    if dispatch in ("critique", "followup_critique") or round_number == 2:
        return _REQUIRED_FIELDS["round2"]
    if dispatch == "synthesis_verdict":
        return _REQUIRED_FIELDS["synthesis_verdict"]
    if dispatch in ("final", "updated_synthesis") or round_number == 3:
        return _REQUIRED_FIELDS["round3"]
    return _REQUIRED_FIELDS["round1"]


def validate_structured_output(
    payload: dict,
    *,
    round_number: int,
    round_type: str | None,
    raw_content: str | None = None,
) -> list[str]:
    """Return a list of hard-failure reason codes for a normalized payload.

    Empty list ⇒ the payload is structurally usable. A non-empty list means the
    output is malformed and must be retried / repaired / failed.
    """
    reasons: list[str] = []

    if not isinstance(payload, dict):
        return ["malformed_payload_not_object"]

    if raw_content is not None and not str(raw_content).strip():
        reasons.append("empty_response")

    if payload.get("is_fallback") is True:
        reasons.append("json_parse_failed_used_text_fallback")

    body = ""
    for key in ("response", "display_content", "main_argument", "conclusion"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            body = value
            break

    if not body.strip():
        reasons.append("missing_response_body")
    elif len(body.strip()) < _MIN_RESPONSE_CHARS:
        reasons.append("response_too_short")

    # Placeholder / schema fragments anywhere in the user-facing content.
    scan_text = _collect_user_facing_text(payload)
    if _has_malformed_fragments(scan_text):
        reasons.append("placeholder_output")

    # Required field groups.
    for group in _required_groups_for(round_number, round_type):
        if not any(_non_empty(payload, key) for key in group):
            reasons.append("missing_required_fields")
            break

    return reasons


__all__ = [
    "QualityIssue",
    "QualityReport",
    "PromptLeakValidator",
    "ArgumentQualityValidator",
    "CritiqueQualityValidator",
    "SynthesisQualityValidator",
    "evaluate_round_quality",
    "validate_structured_output",
]
