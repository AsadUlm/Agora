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
        "key_points",
        "confidence",
        "position_evolution",
        "response",
    ],
    "followup_critique": [
        "one_sentence_takeaway",
        "short_summary",
        "target_agent",
        "target_kind",
        "challenge",
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
) -> dict | None:
    """Stage 2: ask the LLM to convert its own RAW output into strict JSON.

    Returns a parsed dict on success, ``None`` on any failure. The caller is
    responsible for falling back to the regex/heuristic parser when this
    returns ``None``.
    """
    if not (raw_text or "").strip():
        return None
    prompt = build_recovery_prompt(raw_text, round_number, round_type)
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


__all__ = [
    "LLMCallable",
    "build_recovery_prompt",
    "recover_json_with_llm",
]


def _unused() -> None:  # noqa: D401
    """Touch json import to satisfy linters that flag unused imports."""
    _ = json
