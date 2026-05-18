"""LLM response normalization and validation for debate rounds."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.services.llm.exceptions import LLMParseError
from app.services.llm.parser import parse_json_from_llm

logger = logging.getLogger(__name__)

_MAX_SUMMARY_CHARS = 220
_NO_PUNCTUATION_FALLBACK_CHARS = 200

_META_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in [
        r"(?im)^\s*(i need to|i will|i'm going to|let me)\b[^.!?\n]*[.!?]?",
        r"(?im)^\s*(generating|generate|here is|below is)\b[^.!?\n]*[.!?]?",
        r"(?i)\b(i need to|i will|i'm going to)\b[^.!?\n]*(json|schema|format|object)[^.!?\n]*[.!?]?",
        r"(?i)\b(generating|generate)\b[^.!?\n]*(json|synthesis|object)[^.!?\n]*[.!?]?",
        r"(?i)\b(here is|below is)\b[^.!?\n]*(json|object|answer)[^.!?\n]*[.!?]?",
        r"(?i)\bas an ai\b[^.!?\n]*[.!?]?",
        r"(?i)\b(return only|schema|field list|instruction)\b[^.!?\n]*[.!?]?",
    ]
)
_CODE_FENCE_RE = re.compile(r"```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```")
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+", flags=re.MULTILINE)
_BOLD_RE = re.compile(r"\*\*(.*?)\*\*")
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]+")

_STRONG_CLAIM_KEYWORDS = (
    "strongest",
    "because",
    "therefore",
    "should",
    "must",
    "best",
    "core",
    "central",
    "key",
    "evidence",
)

# FIX-11: target_roles enumeration. Used by round 2 + follow-up critique
# normalizers to expose a structured list of roles a critique points at,
# instead of relying on the free-text ``target_agent`` field downstream.
_ROLE_ORDER = ("analyst", "critic", "creative", "moderator")


def _parse_target_roles(raw_target: str) -> list[str]:
    """Extract a normalized list of target roles from a critique's free-text
    ``target_agent`` field. Falls back to ``["general"]`` when no known role
    is mentioned (e.g. "General position", "Strongest argument").
    """
    lowered = (raw_target or "").lower()
    found = [role for role in _ROLE_ORDER if role in lowered]
    return found or ["general"]

_CONCERN_KEYWORDS = (
    "concern",
    "risks",
    "unresolved",
    "caveat",
    "limitation",
    "trade-off",
    "tradeoff",
)
_CHANGE_KEYWORDS = (
    "changed",
    "refined",
    "after",
    "critique",
    "considering",
    "now",
)


@dataclass(frozen=True)
class NormalizedRoundOutput:
    payload: dict[str, Any]
    short_summary: str
    display_content: str
    raw_content: str
    is_fallback: bool = False


def normalize_round_output(
    round_number: int,
    raw_text: str,
    parsed_payload: dict[str, Any] | None = None,
    round_type: str | None = None,
) -> NormalizedRoundOutput:
    """Normalize a round output, falling back to clean raw text when JSON fails.

    ``round_type`` (when provided) takes precedence over ``round_number`` for
    dispatching, so follow-up cycles (round_number ≥ 4) can route to the
    follow-up normalizers without being mistaken for unsupported rounds.
    """
    parse_status: str = "parsed"
    parse_warnings: list[str] = []

    if parsed_payload is None:
        try:
            parsed_payload = parse_json_from_llm(raw_text)
        except LLMParseError as exc:
            logger.warning("JSON parse failed -> fallback mode used: %s", exc)
            return fallback_parse(raw_text, round_number=round_number, round_type=round_type)

    if not isinstance(parsed_payload, dict):
        logger.warning("JSON parse failed -> fallback mode used: parsed output is not an object")
        return fallback_parse(raw_text, round_number=round_number, round_type=round_type)

    try:
        dispatch = (round_type or "").lower()
        if dispatch == "followup_response":
            payload = _normalize_followup_response(parsed_payload, raw_text)
        elif dispatch == "followup_critique":
            payload = _normalize_followup_critique(parsed_payload, raw_text)
        elif dispatch == "updated_synthesis":
            payload = _normalize_updated_synthesis(parsed_payload, raw_text)
        elif dispatch == "synthesis_verdict":
            payload = _normalize_synthesis_verdict(parsed_payload, raw_text)
        elif round_number == 1:
            payload = _normalize_round1(parsed_payload, raw_text)
        elif round_number == 2:
            payload = _normalize_round2(parsed_payload, raw_text)
        elif round_number == 3:
            payload = _normalize_round3(parsed_payload, raw_text)
        else:
            logger.warning("JSON parse failed -> fallback mode used: unsupported round %s", round_number)
            return fallback_parse(raw_text, round_number=round_number, round_type=round_type)
    except LLMParseError as exc:
        logger.warning("JSON parse failed -> fallback mode used: %s", exc)
        return fallback_parse(raw_text, round_number=round_number, round_type=round_type)

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary"]),
        _pick_string(payload, ["response", "main_argument", "conclusion"]),
    )
    # Preserve paragraphs in display_content so the detail panel can render
    # the full multi-paragraph analytical response verbatim. Previously this
    # was sanitized with default settings and collapsed every newline into a
    # single space, which produced wall-of-text answers in the UI.
    display_content = _pick_long_text(payload, ["response", "main_argument", "conclusion"])
    if not display_content:
        display_content = _sanitize_text(
            _pick_string(payload, ["response", "main_argument", "conclusion"]),
            preserve_paragraphs=True,
        )

    if not display_content:
        logger.warning("JSON parse failed -> fallback mode used: normalized output has no readable response")
        return fallback_parse(raw_text, round_number=round_number)

    # Anti-repetition guard: if `response` collapsed to the same text as
    # the takeaway (a common low-quality output), try to recover a richer
    # body from raw_content. Mark a warning either way so the Raw tab can
    # surface the issue.
    if _texts_too_similar(display_content, short_summary, threshold=0.92):
        recovered_body = _recover_full_response_from_raw(raw_text)
        if recovered_body and not _texts_too_similar(
            recovered_body, short_summary, threshold=0.92
        ):
            display_content = recovered_body
            payload["response"] = recovered_body
            parse_warnings.append("response_was_duplicate_of_takeaway_recovered_from_raw")
            parse_status = "recovered"
        else:
            parse_warnings.append("response_duplicates_takeaway")
            parse_status = "partial" if parse_status == "parsed" else parse_status

    # FIX-06: detect when `response` is just a concatenation of the other
    # JSON fields (one_sentence_takeaway + short_summary + key_points).
    # That's a quality failure — the LLM produced a stitched-together prose
    # body instead of a fresh analytical answer. Try to recover a richer
    # body from the raw text; otherwise emit a parse warning.
    concat_probe = " ".join(
        str(x or "")
        for x in (
            payload.get("one_sentence_takeaway", ""),
            payload.get("short_summary", ""),
            *(payload.get("key_points") or []),
            payload.get("answer_to_followup", ""),
        )
    ).strip()
    if concat_probe and _texts_too_similar(display_content, concat_probe, threshold=0.85):
        recovered_body = _recover_full_response_from_raw(raw_text)
        if recovered_body and not _texts_too_similar(
            recovered_body, concat_probe, threshold=0.85
        ):
            display_content = recovered_body
            payload["response"] = recovered_body
            parse_warnings.append("response_field_concatenation_recovered_from_raw")
            parse_status = "recovered"
        else:
            parse_warnings.append("response_looks_like_field_concatenation")
            parse_status = "partial" if parse_status == "parsed" else parse_status

    # FIX-07: enforce field differentiation between one_sentence_takeaway
    # and short_summary. They MUST add distinct information; if they are
    # essentially identical, emit a warning so the UI can surface it.
    raw_short_summary = str(payload.get("short_summary", "") or "").strip()
    raw_takeaway = str(payload.get("one_sentence_takeaway", "") or "").strip()
    if (
        raw_short_summary
        and raw_takeaway
        and (
            raw_short_summary == raw_takeaway
            or _texts_too_similar(raw_short_summary, raw_takeaway, threshold=0.90)
        )
    ):
        parse_warnings.append("short_summary_duplicates_takeaway")

    # Mirror one_sentence_takeaway ↔ short_summary so back-compat consumers
    # (and existing tests) still see ``short_summary`` while new UIs can
    # prefer the takeaway field.
    payload["one_sentence_takeaway"] = short_summary
    payload["short_summary"] = short_summary
    payload["display_content"] = display_content
    payload["raw_content"] = raw_text
    payload["is_fallback"] = False
    payload["parse_status"] = parse_status
    if parse_warnings:
        payload["parse_warnings"] = parse_warnings

    return NormalizedRoundOutput(
        payload=payload,
        short_summary=short_summary,
        display_content=display_content,
        raw_content=raw_text,
        is_fallback=False,
    )


def fallback_parse(raw_text: str, round_number: int = 0, round_type: str | None = None) -> NormalizedRoundOutput:
    """Build a safe structured response from non-JSON model output."""
    extracted = _extract_best_jsonish_field(raw_text)
    paragraph_text = _sanitize_text(extracted or raw_text, preserve_paragraphs=True)
    cleaned_text = _sanitize_text(paragraph_text or extracted or raw_text)

    if not cleaned_text:
        cleaned_text = "Response generated, but could not be formatted."

    short_summary = generate_summary(cleaned_text, max_chars=_MAX_SUMMARY_CHARS)
    payload: dict[str, Any] = {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "response": cleaned_text,
        "display_content": cleaned_text,
        "is_fallback": True,
        "raw_content": raw_text,
        "parse_status": "fallback",
        "parse_warnings": ["json_parse_failed_used_text_fallback"],
    }

    rt = (round_type or "").lower()
    if rt == "followup_response":
        payload.update(
            {
                "answer_to_followup": cleaned_text,
                "position_update": "",
                "key_points": _derive_points_from_text(cleaned_text),
                "confidence": "medium",
                "position_evolution": {
                    "previous_position": "",
                    "updated_position": _first_sentence(cleaned_text) or short_summary,
                    "change_type": "unchanged",
                    "reason": "Response could not be parsed; assumed unchanged.",
                },
            }
        )
    elif rt == "followup_critique":
        payload.update(
            {
                "target_agent": "General position",
                "target_roles": ["general"],
                "target_kind": "unresolved_question",
                "challenge": short_summary,
                "counterargument": cleaned_text,
                "impact": "Adopting this counter would reframe the most uncertain part of the answer.",
                "assumption_attacked": _first_sentence(cleaned_text) or short_summary,
                "why_it_breaks": "The unparsed response left the assumption implicit; this critique surfaces it as the most fragile premise.",
                "real_world_implication": "If this assumption fails in practice, the recommended action needs to be re-scoped.",
            }
        )
    elif rt == "updated_synthesis":
        # FIX-04: do NOT fabricate generic synthesis text. Leave the fields
        # blank when the model output cannot be parsed; emit warnings so the
        # UI / debug panel can surface that fields were unavailable.
        payload.update(
            {
                "updated_conclusion": _first_sentence(cleaned_text) or short_summary,
                "conclusion_changed": "no",
                "change_reason": "",
                "what_changed": "",
                "strongest_argument": _strongest_claim_sentence(cleaned_text) or "",
                "remaining_disagreement": _keyword_sentence(cleaned_text, _CONCERN_KEYWORDS) or "",
                "key_tradeoff": "",
                "winning_argument": _strongest_claim_sentence(cleaned_text) or "",
                "losing_argument": "",
                "confidence": "low",
            }
        )
        payload.setdefault("parse_warnings", []).extend(
            [
                "updated_synthesis_change_reason_missing",
                "updated_synthesis_what_changed_missing",
                "updated_synthesis_losing_argument_missing",
                "updated_synthesis_key_tradeoff_missing",
            ]
        )
    elif rt == "synthesis_verdict":
        # Step 37: do NOT fabricate aggregation. Leave aggregation fields
        # blank when the model output cannot be parsed and surface every
        # missing field as a parse warning so the UI can show it honestly.
        payload.update(
            {
                "one_sentence_takeaway": short_summary,
                "consensus_statement": "",
                "main_disagreement": "",
                "recommended_answer": _first_sentence(cleaned_text) or short_summary,
                "winning_side": "mixed",
                "confidence": "low",
                "what_changed": "",
                "reasoning_basis": [],
                "unresolved_questions": [],
                "response": cleaned_text,
            }
        )
        payload.setdefault("parse_warnings", []).extend(
            [
                "synthesis_verdict_consensus_missing",
                "synthesis_verdict_main_disagreement_missing",
                "synthesis_verdict_reasoning_basis_missing",
            ]
        )
        payload.update(
            {
                "stance": "Mixed",
                "main_argument": cleaned_text,
                "key_points": _derive_points_from_text(cleaned_text),
                "risks_or_caveats": [],
            }
        )
    elif round_number == 2:
        payload.update(
            {
                "target_agent": "General position",
                "target_roles": ["general"],
                "challenge": short_summary,
                "weakness_found": "The response was not structured, so the critique was formatted from the available text.",
                "counterargument": cleaned_text,
                "assumption_attacked": _first_sentence(cleaned_text) or short_summary,
                "why_it_breaks": "The unstructured response did not isolate the assumption, so this critique flags the strongest claim as the weakest link.",
                "real_world_implication": "If the assumption fails, the recommended action would need to be re-scoped before deployment.",
            }
        )
    elif round_number == 3:
        round3_fields = _build_round3_fallback_fields(cleaned_text, paragraph_text)
        round3_warnings = round3_fields.pop("_parse_warnings_round3", [])
        payload.update(round3_fields)
        if round3_warnings:
            payload.setdefault("parse_warnings", []).extend(round3_warnings)

    return NormalizedRoundOutput(
        payload=payload,
        short_summary=short_summary,
        display_content=cleaned_text,
        raw_content=raw_text,
        is_fallback=True,
    )


def normalize_summary(summary: str, fallback_text: str, max_chars: int = _MAX_SUMMARY_CHARS) -> str:
    """Normalize summary into a complete user-facing sentence."""
    base = _sanitize_text(summary)
    fallback = _sanitize_text(fallback_text)
    return generate_summary(base or fallback, max_chars=max_chars)


def generate_summary(text: str, max_chars: int = _MAX_SUMMARY_CHARS) -> str:
    """Generate a sentence-safe summary from cleaned model text."""
    cleaned = _sanitize_text(text)
    if not cleaned:
        return "Response generated, but could not be formatted."

    complete_sentences = _complete_sentences(cleaned)
    if complete_sentences:
        # Never cut through a sentence. The length target applies when the model
        # gives a usable complete sentence; unusually long sentences are kept
        # intact rather than producing broken UI text.
        return _ensure_terminal_punctuation(complete_sentences[0])

    fallback = _clip_without_sentence(cleaned, _NO_PUNCTUATION_FALLBACK_CHARS)
    return _ensure_terminal_punctuation(fallback)


def _build_round3_fallback_fields(cleaned_text: str, paragraph_text: str) -> dict[str, Any]:
    paragraphs = _paragraphs(paragraph_text or cleaned_text)
    final_position = paragraphs[0] if paragraphs else generate_summary(cleaned_text)
    conclusion = paragraphs[-1] if paragraphs else final_position

    # FIX-04: when fallback parsing kicks in we no longer fabricate generic
    # synthesis sentences. Empty fields are surfaced as warnings instead of
    # silently inventing plausible-sounding content.
    strongest_argument = _strongest_claim_sentence(cleaned_text) or ""
    what_changed = _keyword_sentence(cleaned_text, _CHANGE_KEYWORDS) or ""
    remaining_concerns = _keyword_sentence(cleaned_text, _CONCERN_KEYWORDS) or ""

    return {
        "final_position": final_position,
        "what_changed": what_changed,
        "strongest_argument": strongest_argument,
        "remaining_concerns": remaining_concerns,
        "conclusion": conclusion,
        "key_tradeoff": remaining_concerns or "",
        "winning_argument": strongest_argument,
        "losing_argument": "",
        "confidence": "low",
        "_parse_warnings_round3": [
            warn for warn, present in (
                ("round3_what_changed_missing", bool(what_changed)),
                ("round3_strongest_argument_missing", bool(strongest_argument)),
                ("round3_losing_argument_missing", False),
                ("round3_key_tradeoff_missing", bool(remaining_concerns)),
            ) if not present
        ],
    }


def _normalize_round1(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    response = _pick_long_text(payload, ["response", "main_argument", "stance", "text"])
    main_argument = _pick_long_text(payload, ["main_argument", "response", "stance"]) or response
    stance = _normalize_stance(_pick_string(payload, ["stance", "position", "final_position", "final_stance"]))

    key_points = _pick_string_list(payload, ["key_points"])
    risks = _pick_string_list(payload, ["risks_or_caveats", "risks"]) or []

    if not response:
        response = main_argument or _sanitize_text(raw_text, preserve_paragraphs=True)

    if not response:
        raise LLMParseError("Round 1 output missing response content.")

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    if not key_points:
        key_points = _derive_points_from_text(response)

    return {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "stance": stance or "Mixed",
        "main_argument": main_argument or response,
        "key_points": key_points,
        "risks_or_caveats": risks,
        "response": response,
    }


def _normalize_round2(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    first_critique = _first_critique(payload)

    target_agent = _pick_string(payload, ["target_agent", "target_role"]) or _pick_string(
        first_critique,
        ["target_agent", "target_role"],
    )
    challenge = _pick_long_text(payload, ["challenge", "critique"]) or _pick_long_text(
        first_critique,
        ["challenge", "critique"],
    )
    weakness = _pick_string(payload, ["weakness_found", "weakness"]) or _pick_string(
        first_critique,
        ["weakness_found", "weakness"],
    )
    counter = _pick_long_text(payload, ["counterargument", "counter_evidence"]) or _pick_long_text(
        first_critique,
        ["counterargument", "counter_evidence"],
    )
    response = _pick_long_text(payload, ["response", "text", "challenge", "counterargument"])

    if not target_agent:
        target_agent = "General position"
    if not challenge:
        challenge = "The target response was unavailable, so this critique focuses on the general position."
    if not weakness:
        weakness = "The target argument lacks sufficient support or leaves key assumptions unaddressed."
    if not counter:
        counter = "A stronger position should address implementation constraints and provide clearer evidence."

    if not response:
        response = _sanitize_text(raw_text, preserve_paragraphs=True)
    if not response:
        response = f"{challenge} {counter}".strip()

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    assumption_attacked = _pick_string(payload, ["assumption_attacked"]) or _pick_string(
        first_critique, ["assumption_attacked"]
    ) or weakness or _first_sentence(challenge)
    why_it_breaks = _pick_string(payload, ["why_it_breaks"]) or _pick_string(
        first_critique, ["why_it_breaks"]
    ) or weakness
    real_world_implication = _pick_string(payload, ["real_world_implication"]) or _pick_string(
        first_critique, ["real_world_implication"]
    ) or "If this assumption fails, the recommended action would need to be re-scoped before deployment."

    return {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "target_agent": target_agent,
        "target_roles": _parse_target_roles(target_agent),
        "challenge": challenge,
        "weakness_found": weakness,
        "counterargument": counter,
        "assumption_attacked": assumption_attacked,
        "why_it_breaks": why_it_breaks,
        "real_world_implication": real_world_implication,
        "response": response,
    }


def _normalize_round3(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    final_position = _pick_long_text(payload, ["final_position", "final_stance", "stance", "conclusion"])
    what_changed = _pick_long_text(payload, ["what_changed"])
    strongest_argument = _pick_long_text(payload, ["strongest_argument", "main_argument", "challenge"])
    remaining_concerns = _pick_long_text(payload, ["remaining_concerns", "risks_or_caveats"]) 
    conclusion = _pick_long_text(payload, ["conclusion", "recommendation", "final_position"])
    response = _pick_long_text(payload, ["response", "text", "conclusion", "final_position"])

    if not response:
        response = _sanitize_text(raw_text, preserve_paragraphs=True)

    # FIX-04: do NOT fabricate generic synthesis sentences. Track which fields
    # were missing so the UI can surface them as warnings instead of silently
    # showing invented content.
    round3_warnings: list[str] = []
    if not final_position:
        final_position = conclusion or _first_sentence(response)
        if not final_position:
            round3_warnings.append("round3_final_position_missing")
    if not what_changed:
        what_changed = ""
        round3_warnings.append("round3_what_changed_missing")
    if not strongest_argument:
        strongest_argument = ""
        round3_warnings.append("round3_strongest_argument_missing")
    if not remaining_concerns:
        remaining_concerns = ""
        round3_warnings.append("round3_remaining_concerns_missing")
    if not conclusion:
        conclusion = final_position or _first_sentence(response)

    if not response:
        raise LLMParseError("Round 3 output missing response content.")

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    key_tradeoff = _pick_string(payload, ["key_tradeoff", "trade_off", "tradeoff"]) or remaining_concerns
    winning_argument = _pick_string(payload, ["winning_argument"]) or strongest_argument
    losing_argument = _pick_string(payload, ["losing_argument"])
    if not losing_argument:
        losing_argument = ""
        round3_warnings.append("round3_losing_argument_missing")
    confidence = (_pick_string(payload, ["confidence"]) or "medium").lower()
    if confidence not in ("low", "medium", "high"):
        confidence = "medium"

    out = {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "final_position": final_position or "Mixed",
        "what_changed": what_changed,
        "strongest_argument": strongest_argument,
        "remaining_concerns": remaining_concerns,
        "conclusion": conclusion,
        "key_tradeoff": key_tradeoff,
        "winning_argument": winning_argument,
        "losing_argument": losing_argument,
        "confidence": confidence,
        "confidence_level": _pick_string(payload, ["confidence_level"]).lower() or confidence,
        "core_consensus": _pick_string(payload, ["core_consensus", "consensus"]),
        "major_disagreements": _pick_string_list(payload, ["major_disagreements", "disagreements"]),
        "risk_tradeoffs": _pick_string_list(payload, ["risk_tradeoffs", "risks", "trade_offs"]),
        "policy_direction": _pick_string(payload, ["policy_direction", "recommended_direction"]) or final_position,
        "unresolved_questions": _pick_string_list(payload, ["unresolved_questions", "open_questions"]),
        "position_shift": _pick_string(payload, ["position_shift"]) or what_changed,
        "response": response,
    }
    if round3_warnings:
        out["parse_warnings"] = round3_warnings
    return out


# ── Follow-up cycle normalizers ──────────────────────────────────────────────

def _normalize_followup_response(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    response = _pick_long_text(payload, ["response", "answer_to_followup", "main_argument", "text"])
    answer = _pick_long_text(payload, ["answer_to_followup", "answer", "response"]) or response
    position_update = _pick_string(payload, ["position_update", "stance_update", "position_change"])
    confidence = (_pick_string(payload, ["confidence"]) or "medium").lower()
    if confidence not in ("low", "medium", "high"):
        confidence = "medium"

    key_points = _pick_string_list(payload, ["key_points"])
    if not response:
        response = answer or _sanitize_text(raw_text, preserve_paragraphs=True)
    if not response:
        raise LLMParseError("Follow-up response missing content.")

    if not key_points:
        key_points = _derive_points_from_text(response)

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    position_evolution = _normalize_position_evolution(
        payload.get("position_evolution"),
        fallback_updated=answer or response,
        fallback_reason=position_update,
    )
    # Mirror reason → position_update for backward compatibility.
    if not position_update and position_evolution.get("reason"):
        position_update = position_evolution["reason"]

    return {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "answer_to_followup": answer or response,
        "position_update": position_update,
        "position_evolution": position_evolution,
        "key_points": key_points,
        "confidence": confidence,
        "response": response,
    }


def _normalize_followup_critique(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    target_agent = _pick_string(payload, ["target_agent", "target_role"]) or "General position"
    target_kind = (_pick_string(payload, ["target_kind"]) or "").lower()
    if target_kind not in ("peer", "strongest_argument", "unresolved_question"):
        target_kind = "peer"
    challenge = _pick_long_text(payload, ["challenge", "critique"])
    counter = _pick_long_text(payload, ["counterargument", "counter_evidence"])
    impact = _pick_string(payload, ["impact"])
    response = _pick_long_text(payload, ["response", "text", "challenge", "counterargument"])

    if not response:
        response = _sanitize_text(raw_text, preserve_paragraphs=True)
    if not response:
        response = f"{challenge} {counter}".strip()
    if not response:
        raise LLMParseError("Follow-up critique missing content.")

    if not challenge:
        challenge = "The peer follow-up answer leaves a key assumption unexamined."
    if not counter:
        counter = "A stronger answer would address the underlying constraint directly."
    if not impact:
        impact = "Adopting this counter would change which trade-off is treated as primary."

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    assumption_attacked = _pick_string(payload, ["assumption_attacked"]) or _first_sentence(challenge)
    why_it_breaks = _pick_string(payload, ["why_it_breaks"]) or "The targeted assumption does not hold under the new follow-up question."
    real_world_implication = _pick_string(payload, ["real_world_implication"]) or "If this assumption fails, the recommended action would need to be re-scoped before deployment."

    return {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "target_agent": target_agent,
        "target_roles": _parse_target_roles(target_agent),
        "target_kind": target_kind,
        "challenge": challenge,
        "counterargument": counter,
        "impact": impact,
        "assumption_attacked": assumption_attacked,
        "why_it_breaks": why_it_breaks,
        "real_world_implication": real_world_implication,
        "response": response,
    }


def _normalize_updated_synthesis(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    updated_conclusion = _pick_long_text(payload, ["updated_conclusion", "conclusion", "final_position"])
    what_changed = _pick_long_text(payload, ["what_changed"])
    strongest_argument = _pick_long_text(payload, ["strongest_argument", "main_argument"])
    remaining = _pick_long_text(payload, ["remaining_disagreement", "remaining_concerns", "open_questions"])
    response = _pick_long_text(payload, ["response", "text", "updated_conclusion", "conclusion"])

    conclusion_changed_raw = _pick_string(
        payload, ["conclusion_changed", "changed", "position_changed"]
    ).lower()
    if conclusion_changed_raw in ("yes", "true", "y", "1", "changed"):
        conclusion_changed = "yes"
    elif conclusion_changed_raw in ("no", "false", "n", "0", "unchanged"):
        conclusion_changed = "no"
    else:
        # Heuristic: if `what_changed` mentions "unchanged"/"no change", say no.
        wc_low = (what_changed or "").lower()
        if any(token in wc_low for token in ("unchanged", "no change", "did not change", "holds")):
            conclusion_changed = "no"
        elif what_changed:
            conclusion_changed = "yes"
        else:
            conclusion_changed = "no"

    change_reason = _pick_string(
        payload, ["change_reason", "reason_for_change", "why_changed"]
    )

    if not response:
        response = _sanitize_text(raw_text, preserve_paragraphs=True)
    if not response:
        raise LLMParseError("Updated synthesis missing content.")

    if not updated_conclusion:
        updated_conclusion = _first_sentence(response)
    # FIX-04: stop fabricating generic synthesis text. Empty fields surface as
    # parse_warnings so the UI / debug panel can show what was missing.
    upd_warnings: list[str] = []
    if not what_changed:
        what_changed = ""
        upd_warnings.append("updated_synthesis_what_changed_missing")
    if not strongest_argument:
        strongest_argument = _strongest_claim_sentence(response) or ""
        if not strongest_argument:
            upd_warnings.append("updated_synthesis_strongest_argument_missing")
    if not remaining:
        remaining = ""
        upd_warnings.append("updated_synthesis_remaining_disagreement_missing")
    if not change_reason:
        change_reason = ""
        upd_warnings.append("updated_synthesis_change_reason_missing")

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        response,
    )

    key_tradeoff = _pick_string(payload, ["key_tradeoff", "trade_off", "tradeoff"]) or remaining
    winning_argument = _pick_string(payload, ["winning_argument"]) or strongest_argument
    losing_argument = _pick_string(payload, ["losing_argument"])
    if not losing_argument:
        losing_argument = ""
        upd_warnings.append("updated_synthesis_losing_argument_missing")
    confidence = (_pick_string(payload, ["confidence"]) or "medium").lower()
    if confidence not in ("low", "medium", "high"):
        confidence = "medium"

    out = {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "updated_conclusion": updated_conclusion,
        "conclusion_changed": conclusion_changed,
        "change_reason": change_reason,
        "what_changed": what_changed,
        "strongest_argument": strongest_argument,
        "remaining_disagreement": remaining,
        "key_tradeoff": key_tradeoff,
        "winning_argument": winning_argument,
        "losing_argument": losing_argument,
        "confidence": confidence,
        "confidence_level": _pick_string(payload, ["confidence_level"]).lower() or confidence,
        "core_consensus": _pick_string(payload, ["core_consensus", "consensus"]),
        "major_disagreements": _pick_string_list(payload, ["major_disagreements", "disagreements"]),
        "risk_tradeoffs": _pick_string_list(payload, ["risk_tradeoffs", "risks", "trade_offs"]),
        "policy_direction": _pick_string(payload, ["policy_direction", "recommended_direction"]) or updated_conclusion,
        "unresolved_questions": _pick_string_list(payload, ["unresolved_questions", "open_questions"]),
        "position_shift": _pick_string(payload, ["position_shift"]) or change_reason,
        "previous_position": _pick_string(payload, ["previous_position", "prev_position"]),
        "new_position": _pick_string(payload, ["new_position", "current_position"]) or updated_conclusion,
        "response": response,
    }
    if upd_warnings:
        out["parse_warnings"] = upd_warnings
    return out


_VALID_WINNING_SIDES = {"analyst", "critic", "creative", "draw", "mixed"}
_VALID_CONFIDENCE = {"low", "medium", "high"}


def _normalize_synthesis_verdict(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    """Normalize the moderator-aggregator verdict (Step 37).

    The verdict is a single neutral aggregation produced after Round 3 (or
    each follow-up cycle). It must NOT fabricate fields: every missing
    field is surfaced via ``parse_warnings`` so the UI can show it
    honestly.
    """
    warnings: list[str] = []

    consensus = _pick_long_text(payload, ["consensus_statement", "consensus", "core_consensus"])
    main_disagreement = _pick_long_text(
        payload, ["main_disagreement", "primary_disagreement", "disagreement"]
    )
    recommended = _pick_long_text(
        payload,
        [
            "recommended_answer",
            "recommendation",
            "policy_direction",
            "final_position",
            "updated_conclusion",
        ],
    )
    response = _pick_long_text(
        payload,
        ["response", "text", "recommended_answer", "consensus_statement"],
    )
    if not response:
        response = _sanitize_text(raw_text, preserve_paragraphs=True)
    if not response and recommended:
        response = recommended
    if not response and consensus:
        response = consensus
    if not response:
        raise LLMParseError("Synthesis verdict missing content.")

    short_summary = normalize_summary(
        _pick_string(payload, ["one_sentence_takeaway", "short_summary", "summary"]),
        recommended or response,
    )

    winning_side = (_pick_string(payload, ["winning_side", "winner"]) or "").lower().strip()
    if winning_side not in _VALID_WINNING_SIDES:
        if winning_side:
            warnings.append("synthesis_verdict_winning_side_invalid")
        winning_side = "mixed"

    confidence = (_pick_string(payload, ["confidence", "confidence_level"]) or "").lower().strip()
    if confidence not in _VALID_CONFIDENCE:
        if confidence:
            warnings.append("synthesis_verdict_confidence_invalid")
        confidence = "medium"

    what_changed = _pick_long_text(payload, ["what_changed", "change_summary"])
    reasoning_basis = _pick_string_list(
        payload, ["reasoning_basis", "reasons", "key_reasons"]
    )
    unresolved = _pick_string_list(
        payload, ["unresolved_questions", "open_questions", "remaining_questions"]
    )

    if not consensus:
        warnings.append("synthesis_verdict_consensus_missing")
    if not main_disagreement:
        warnings.append("synthesis_verdict_main_disagreement_missing")
    if not recommended:
        recommended = _first_sentence(response) or short_summary
        warnings.append("synthesis_verdict_recommended_answer_missing")
    if not reasoning_basis:
        warnings.append("synthesis_verdict_reasoning_basis_missing")

    # Quality guards mirroring the per-agent normalizer.
    raw_short_summary = str(payload.get("short_summary", "") or "").strip()
    raw_takeaway = str(payload.get("one_sentence_takeaway", "") or "").strip()
    if (
        raw_short_summary
        and raw_takeaway
        and (
            raw_short_summary == raw_takeaway
            or _texts_too_similar(raw_short_summary, raw_takeaway, threshold=0.90)
        )
    ):
        warnings.append("short_summary_duplicates_takeaway")

    concat_probe = " ".join(
        str(x or "")
        for x in (
            payload.get("one_sentence_takeaway", ""),
            payload.get("consensus_statement", ""),
            payload.get("main_disagreement", ""),
            payload.get("recommended_answer", ""),
            *(payload.get("reasoning_basis") or []),
        )
    ).strip()
    if concat_probe and _texts_too_similar(response, concat_probe, threshold=0.85):
        warnings.append("response_looks_like_field_concatenation")

    out = {
        "one_sentence_takeaway": short_summary,
        "short_summary": short_summary,
        "consensus_statement": consensus,
        "main_disagreement": main_disagreement,
        "recommended_answer": recommended,
        "winning_side": winning_side,
        "confidence": confidence,
        "what_changed": what_changed,
        "reasoning_basis": reasoning_basis,
        "unresolved_questions": unresolved,
        "response": response,
    }
    if warnings:
        out["parse_warnings"] = warnings
    return out


def _normalize_position_evolution(
    raw: Any,
    fallback_updated: str = "",
    fallback_reason: str = "",
) -> dict[str, str]:
    """Normalize the optional position_evolution object into a 4-field dict.

    Accepts both the legacy 5-field shape
    ``{previous_position, updated_position, change_type, reason}`` and the
    simplified Step 25 shape ``{change, reason}`` where ``change`` is one of
    ``no_change | refined | changed``.
    """
    src: dict[str, Any] = raw if isinstance(raw, dict) else {}

    # Simplified shape: ``change`` (no_change | refined | changed) + ``reason``.
    simple_change_raw = (_pick_string(src, ["change"]) or "").lower()
    simple_change_map = {
        "no_change": "unchanged",
        "no-change": "unchanged",
        "none": "unchanged",
        "unchanged": "unchanged",
        "refined": "refined",
        "strengthened": "strengthened",
        "weakened": "weakened",
        "changed": "changed",
    }

    previous_position = _pick_string(src, ["previous_position", "prev_position", "old_position"])
    updated_position = _pick_string(src, ["updated_position", "new_position", "current_position"])
    if not updated_position and fallback_updated:
        updated_position = _sanitize_text(fallback_updated)
    change_type = (_pick_string(src, ["change_type", "type", "kind"]) or "").lower()
    if change_type not in ("unchanged", "refined", "strengthened", "weakened", "changed"):
        if simple_change_raw in simple_change_map:
            change_type = simple_change_map[simple_change_raw]
        elif previous_position and updated_position and previous_position != updated_position:
            change_type = "refined"
        else:
            change_type = "unchanged"
    reason = _pick_string(src, ["reason", "why", "justification"])
    if not reason and fallback_reason:
        reason = _sanitize_text(fallback_reason)
    if not reason:
        reason = (
            "The agent kept the same position; no new evidence forced a change."
            if change_type == "unchanged"
            else "The agent updated the position based on the follow-up question."
        )
    return {
        "previous_position": previous_position,
        "updated_position": updated_position,
        "change_type": change_type,
        "reason": reason,
    }


def _normalize_stance(value: str) -> str:
    stance = _sanitize_text(value)
    if not stance:
        return ""

    lowered = stance.lower()
    if "conditional" in lowered:
        return "Conditional"
    if "mixed" in lowered or "both" in lowered:
        return "Mixed"
    if any(token in lowered for token in ["oppose", "against", "reject", "no"]):
        return "Opposes"
    if any(token in lowered for token in ["support", "favor", "yes", "approve"]):
        return "Supports"
    return stance[:80]


def _pick_string(source: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str):
            sanitized = _sanitize_text(value)
            if sanitized:
                return sanitized
    return ""


def _pick_long_text(source: dict[str, Any], keys: list[str]) -> str:
    """Like ``_pick_string`` but preserves paragraph breaks.

    Used for fields that hold the agent's full analytical answer
    (``response``, ``main_argument``, ``conclusion``, ``challenge``,
    ``counterargument``, ``answer_to_followup``, ``updated_conclusion``,
    ``final_position``). Detail panels render these verbatim, so we must
    not collapse multi-paragraph reasoning into a single wall of text.
    """
    for key in keys:
        value = source.get(key)
        if isinstance(value, str):
            sanitized = _sanitize_text(value, preserve_paragraphs=True)
            if sanitized:
                return sanitized
    return ""


def _pick_string_list(source: dict[str, Any], keys: list[str]) -> list[str]:
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            items = [_sanitize_text(str(item)) for item in value]
            items = [item for item in items if item]
            if items:
                return items
        if isinstance(value, str):
            as_text = _sanitize_text(value)
            if as_text:
                return [as_text]
    return []


def _first_critique(source: dict[str, Any]) -> dict[str, Any]:
    critiques = source.get("critiques")
    if not isinstance(critiques, list) or not critiques:
        return {}
    first = critiques[0]
    if isinstance(first, dict):
        return first
    return {}


def _derive_points_from_text(text: str, limit: int = 3) -> list[str]:
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text)
    points = []
    for part in parts:
        cleaned = _sanitize_text(part)
        if cleaned:
            points.append(cleaned)
        if len(points) >= limit:
            break
    return points or ["The position requires further detail."]


def _complete_sentences(text: str) -> list[str]:
    cleaned = _sanitize_text(text)
    if not cleaned:
        return []
    return [match.group(0).strip() for match in _SENTENCE_RE.finditer(cleaned) if match.group(0).strip()]


def _ensure_terminal_punctuation(text: str) -> str:
    cleaned = _sanitize_text(text)
    if not cleaned:
        return "Response generated, but could not be formatted."
    if cleaned[-1] not in ".!?":
        return f"{cleaned}."
    return cleaned


def _clip_without_sentence(text: str, max_chars: int) -> str:
    cleaned = _sanitize_text(text)
    if len(cleaned) <= max_chars:
        return cleaned
    clipped = cleaned[:max_chars].rstrip()
    boundary = clipped.rfind(" ")
    if boundary > int(max_chars * 0.6):
        clipped = clipped[:boundary].rstrip()
    return clipped.rstrip(" ,;:-")


def _paragraphs(text: str) -> list[str]:
    cleaned = _sanitize_text(text, preserve_paragraphs=True)
    if not cleaned:
        return []
    return [part.strip() for part in re.split(r"\n\s*\n+", cleaned) if part.strip()]


def _keyword_sentence(text: str, keywords: tuple[str, ...]) -> str:
    for sentence in _complete_sentences(text):
        lowered = sentence.lower()
        if any(keyword in lowered for keyword in keywords):
            return sentence
    return ""


def _strongest_claim_sentence(text: str) -> str:
    sentences = _complete_sentences(text)
    if not sentences:
        return ""

    best_sentence = sentences[0]
    best_score = -1
    for sentence in sentences:
        lowered = sentence.lower()
        score = sum(1 for keyword in _STRONG_CLAIM_KEYWORDS if keyword in lowered)
        if "strongest" in lowered:
            score += 3
        if score > best_score:
            best_sentence = sentence
            best_score = score
    return best_sentence


def _extract_best_jsonish_field(text: str) -> str:
    """Recover a useful string field from malformed or embedded JSON-like text."""
    if not text:
        return ""

    keys = [
        "display_content",
        "response",
        "final_position",
        "conclusion",
        "main_argument",
        "challenge",
        "short_summary",
        "text",
    ]
    raw = str(text)
    for key in keys:
        match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"', raw, flags=re.DOTALL)
        if not match:
            continue
        value = match.group(1)
        try:
            decoded = json.loads(f'"{value}"')
        except json.JSONDecodeError:
            decoded = value.replace(r"\n", " ").replace(r'\"', '"')
        cleaned = _sanitize_text(decoded)
        if cleaned:
            return cleaned
    return ""


def _texts_too_similar(a: str, b: str, threshold: float = 0.92) -> bool:
    """Return True when two strings have ≥``threshold`` token overlap.

    Used as an anti-repetition guard between fields like ``response`` and
    ``one_sentence_takeaway`` — exact equality is too strict because models
    often paraphrase the takeaway slightly when filling ``response``.
    """
    if not a or not b:
        return False

    norm = lambda s: re.sub(r"\s+", " ", s.strip().lower())  # noqa: E731
    a_n, b_n = norm(a), norm(b)
    if a_n == b_n:
        return True
    # If the shorter string is a near-perfect prefix/suffix of the longer one
    # we treat them as duplicates; this catches "<takeaway>." vs "<takeaway>".
    short, long = sorted((a_n, b_n), key=len)
    if len(short) >= 24 and short in long and len(short) / max(len(long), 1) >= 0.8:
        return True

    a_tokens = set(re.findall(r"[a-z0-9]+", a_n))
    b_tokens = set(re.findall(r"[a-z0-9]+", b_n))
    if not a_tokens or not b_tokens:
        return False
    overlap = len(a_tokens & b_tokens) / max(len(a_tokens | b_tokens), 1)
    return overlap >= threshold


def _recover_full_response_from_raw(raw_text: str) -> str:
    """Try to pull a richer multi-paragraph ``response`` out of raw text.

    Used when the parsed payload's ``response`` field collapsed to the same
    sentence as the takeaway. Looks for the JSON ``response`` field directly
    in the raw text (handles cases where the parsed value got truncated by
    a malformed sibling field) and falls back to other long-text fields.
    """
    extracted = _extract_best_jsonish_field(raw_text)
    if extracted and len(extracted) > 120:
        return _sanitize_text(extracted, preserve_paragraphs=True)
    return ""


def _looks_json_like(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if (stripped.startswith("{") and stripped.endswith("}")) or (stripped.startswith("[") and stripped.endswith("]")):
        return True
    return bool(re.search(r'"[A-Za-z0-9_ -]+"\s*:', stripped))


def _strip_json_artifacts(text: str) -> str:
    lines: list[str] = []
    for line in str(text).splitlines():
        stripped = line.strip().strip(",")
        if not stripped or stripped in {"{", "}", "[", "]"}:
            continue
        if re.fullmatch(r'"?[A-Za-z0-9_ -]+"?\s*:\s*[\[{]?\s*', stripped):
            continue
        stripped = re.sub(r'^"?[A-Za-z0-9_ -]+"?\s*:\s*', "", stripped)
        stripped = stripped.strip().strip('",')
        if stripped and stripped not in {"{", "}", "[", "]"}:
            lines.append(stripped)
    return " ".join(lines).strip()


def _sanitize_text(text: str, preserve_paragraphs: bool = False) -> str:
    if not text:
        return ""

    cleaned = str(text)
    cleaned = cleaned.replace("\r\n", "\n")
    cleaned = _CODE_FENCE_RE.sub(r"\1", cleaned)
    cleaned = _strip_code_fences(cleaned)
    if _looks_json_like(cleaned):
        best = _extract_best_jsonish_field(cleaned)
        if best:
            cleaned = best
    cleaned = _HEADING_RE.sub("", cleaned)
    cleaned = _BOLD_RE.sub(r"\1", cleaned)
    cleaned = cleaned.replace("**", "")

    for pattern in _META_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)

    cleaned = re.sub(r"(?i)\bjson\b", " ", cleaned)

    if _looks_json_like(cleaned):
        cleaned = _strip_json_artifacts(cleaned) or cleaned

    if preserve_paragraphs:
        cleaned = re.sub(r"[ \t\f\v]+", " ", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        cleaned = re.sub(r" *\n *", "\n", cleaned)
        cleaned = cleaned.strip(" `\n\t")
    else:
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" `\n\t")

    if cleaned.startswith("{") and cleaned.endswith("}"):
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                best = _pick_string(parsed, [
                    "response",
                    "short_summary",
                    "main_argument",
                    "challenge",
                    "final_position",
                    "conclusion",
                    "text",
                ])
                if best:
                    cleaned = best
        except json.JSONDecodeError:
            pass

    if _looks_json_like(cleaned):
        cleaned = _strip_json_artifacts(cleaned) or ""

    return cleaned.strip()


def _strip_code_fences(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    return s


def _first_sentence(text: str) -> str:
    sentences = _complete_sentences(text)
    if sentences:
        return sentences[0]
    return _sanitize_text(text)


def _trim_to_sentence_boundary(text: str, max_chars: int) -> str:
    return generate_summary(text, max_chars=max_chars)
