"""Two-stage structurer — LLM-based JSON recovery.

When the primary LLM response fails JSON parsing, this module asks the model
to convert its own RAW text into strict JSON matching a small, focused schema.
This is *only* invoked as a recovery step (after the primary call already
produced text), so it costs at most one extra short LLM call per failed
agent — never per success.

The cheap regex/heuristic fallback in ``response_normalizer.fallback_parse``
remains the final safety net, so a node never fails outright.
"""

from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from app.schemas.contracts import LLMRequest
from app.services.llm.exceptions import LLMError, LLMParseError
from app.services.llm.parser import parse_json_from_llm

logger = logging.getLogger(__name__)


# ── Per-round-type schema hints ──────────────────────────────────────────────
# Kept short on purpose — we only need to point the model at the required
# keys, not re-specify the entire prompt contract.

_SCHEMA_HINTS: dict[str, list[str]] = {
    "round_1": [
        "one_sentence_takeaway",
        "short_summary",
        "stance",
        "main_argument",
        "key_points",
        "risks_or_caveats",
        "response",
    ],
    "round_2": [
        "one_sentence_takeaway",
        "short_summary",
        "target_agent",
        "target_claim",
        "challenge",
        "weakness_found",
        "counterargument",
        "assumption_attacked",
        "why_it_breaks",
        "real_world_implication",
        "response",
    ],
    "round_3": [
        "one_sentence_takeaway",
        "short_summary",
        "final_position",
        "key_tradeoff",
        "winning_argument",
        "losing_argument",
        "confidence",
        "what_changed",
        "strongest_argument",
        "remaining_concerns",
        "conclusion",
        "response",
    ],
    "followup_response": [
        "one_sentence_takeaway",
        "short_summary",
        "answer_to_followup",
        "followup_answer",
        "current_position",
        "what_changed_from_original",
        "key_points",
        "confidence",
        "position_evolution",
        "response",
    ],
    "followup_critique": [
        "one_sentence_takeaway",
        "short_summary",
        "target_agent",
        "target_claim",
        "target_kind",
        "challenge",
        "weakness_found",
        "assumption_attacked",
        "why_it_breaks",
        "real_world_implication",
        "counterargument",
        "impact",
        "response",
    ],
    "updated_synthesis": [
        "one_sentence_takeaway",
        "short_summary",
        "updated_conclusion",
        "recommended_answer",
        "what_changed_from_previous_verdict",
        "consensus_statement",
        "main_disagreement",
        "conclusion_changed",
        "change_reason",
        "key_tradeoff",
        "winning_argument",
        "losing_argument",
        "confidence",
        "what_changed",
        "strongest_argument",
        "remaining_disagreement",
        "response",
    ],
    "synthesis_verdict": [
        "one_sentence_takeaway",
        "recommended_answer",
        "consensus_statement",
        "main_disagreement",
        "winning_side",
        "confidence",
        "unresolved_questions",
        "tradeoffs",
        "response",
    ],
    "critique_response": [
        "one_sentence_takeaway",
        "short_summary",
        "received_critique_summary",
        "responding_to_agent",
        "challenge_received",
        "response",
        "accepted_points",
        "rejected_points",
        "planned_revision",
        "stance_update"
    ],
    "revised_position": [
        "one_sentence_takeaway",
        "short_summary",
        "initial_position_summary",
        "initial_position",
        "critique_received_from",
        "revised_position",
        "what_changed",
        "change_label",
        "change_summary",
        "changed",
        "change_type",
        "reason_for_change",
        "key_claims",
        "remaining_uncertainties",
        "response"
    ],
    "followup_cross_critique": [
        "one_sentence_takeaway",
        "short_summary",
        "target_agent",
        "target_claim",
        "target_kind",
        "challenge",
        "weakness_found",
        "assumption_attacked",
        "why_it_breaks",
        "real_world_implication",
        "counterargument",
        "impact",
        "response",
    ],
    "followup_response_to_critique": [
        "one_sentence_takeaway",
        "short_summary",
        "responding_to_agent",
        "challenge_received",
        "accepted_points",
        "rejected_points",
        "defense",
        "clarification",
        "planned_revision",
        "response",
    ],
    "followup_revised_position": [
        "one_sentence_takeaway",
        "short_summary",
        "initial_followup_position",
        "critique_received_from",
        "revised_position",
        "what_changed",
        "change_label",
        "confidence",
        "response",
    ],
}


def _resolve_schema_key(round_number: int, round_type: str | None) -> str:
    rt = (round_type or "").lower()
    if rt in _SCHEMA_HINTS:
        return rt
    if round_number == 1:
        return "round_1"
    if round_number == 2:
        return "round_2"
    if round_number == 3:
        return "round_3"
    return "round_1"


def build_recovery_prompt(
    raw_text: str,
    round_number: int,
    round_type: str | None,
    max_chars: int = 1800,
    response_language_code: str = "en",
    response_language_name: str = "English",
) -> str:
    """Build a tiny, focused prompt that converts RAW text into strict JSON."""
    key = _resolve_schema_key(round_number, round_type)
    keys = _SCHEMA_HINTS[key]
    snippet = raw_text or ""
    if len(snippet) > max_chars:
        snippet = snippet[: max_chars - 1].rstrip() + "…"

    field_lines = "\n".join(f"  - {k}" for k in keys)
    return (
        "You are a strict JSON formatter.\n\n"
        "Convert the following debate response into a single JSON object that "
        "preserves the original meaning. Do not invent new content. "
        "Do not add commentary, markdown, code fences, or prose outside JSON.\n\n"
        f"Preserve the target response language: {response_language_name} "
        f"({response_language_code}). Keep natural-language values in "
        f"{response_language_name} whenever possible. Only repair JSON structure; "
        "do not translate or rewrite the argument. Keep JSON keys in English.\n\n"
        f"Required keys (use empty string \"\" or empty list [] when the source "
        f"does not cover a key — never omit a key):\n{field_lines}\n\n"
        "- one_sentence_takeaway must be ONE complete sentence (15-25 words) "
        "capturing the core claim. Never truncate.\n"
        "- short_summary must mirror one_sentence_takeaway.\n"
        "- All list fields must be JSON arrays of strings.\n"
        "- 'confidence' (when present) must be one of: low, medium, high.\n"
        "- 'conclusion_changed' (when present) must be exactly: yes or no.\n"
        "- 'position_evolution' (when present) must be an object with at "
        "least 'change' (one of: no_change, refined, changed) and 'reason'.\n"
        "- 'response' must be the full readable text from the source.\n\n"
        "Return ONLY the JSON object — no fences, no preface.\n\n"
        "Source response:\n"
        "<<<\n"
        f"{snippet}\n"
        ">>>"
    )


# Public type alias for the LLM call wrapper.
LLMCallable = Callable[[LLMRequest], Awaitable[str]]


async def recover_json_with_llm(
    raw_text: str,
    *,
    round_number: int,
    round_type: str | None,
    llm_call: LLMCallable,
    provider: str,
    model: str,
    temperature: float = 0.0,
    max_tokens: int = 700,
    response_language_code: str = "en",
    response_language_name: str = "English",
) -> dict | None:
    """Stage 2: ask the LLM to convert its own RAW output into strict JSON.

    Returns a parsed dict on success, ``None`` on any failure. The caller is
    responsible for falling back to the regex/heuristic parser when this
    returns ``None``.
    """
    if not (raw_text or "").strip():
        return None
    prompt = build_recovery_prompt(
        raw_text,
        round_number,
        round_type,
        response_language_code=response_language_code,
        response_language_name=response_language_name,
    )
    request = LLMRequest(
        provider=provider,
        model=model,
        prompt=prompt,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    try:
        text = await llm_call(request)
    except LLMError as exc:
        logger.warning("Two-stage recovery LLM call failed: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Two-stage recovery LLM call raised unexpected error: %s", exc)
        return None
    if not text or not text.strip():
        return None
    try:
        parsed = parse_json_from_llm(text)
    except LLMParseError as exc:
        logger.info("Two-stage recovery output still not valid JSON: %s", exc)
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


async def repair_structured_output_with_moderator(
    raw_content: str,
    *,
    round_number: int,
    round_type: str | None,
    llm_call: LLMCallable,
    provider: str,
    model: str,
    temperature: float = 0.0,
    max_tokens: int = 900,
    response_language_code: str = "en",
    response_language_name: str = "English",
) -> dict | None:
    """Phase 4: last-resort JSON repair using the stable moderator model.

    Extracts and reformats content already present in ``raw_content`` into a
    valid JSON object for the round. Never invents new argument content — if
    the source is unusable, returns ``None`` and the caller marks the node as
    failed. ``provider`` / ``model`` should be the configured moderator
    (Claude Sonnet 4.6) for maximum structured-output reliability.
    """
    if not (raw_content or "").strip():
        return None
    return await recover_json_with_llm(
        raw_content,
        round_number=round_number,
        round_type=round_type,
        llm_call=llm_call,
        provider=provider,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        response_language_code=response_language_code,
        response_language_name=response_language_name,
    )


__all__ = [
    "LLMCallable",
    "build_recovery_prompt",
    "recover_json_with_llm",
    "repair_structured_output_with_moderator",
]


def _unused() -> None:  # noqa: D401
    """Touch json import to satisfy linters that flag unused imports."""
    _ = json
