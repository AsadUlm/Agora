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

_MAX_SUMMARY_CHARS = 180
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
) -> NormalizedRoundOutput:
    """Normalize a round output, falling back to clean raw text when JSON fails."""
    if parsed_payload is None:
        try:
            parsed_payload = parse_json_from_llm(raw_text)
        except LLMParseError as exc:
            logger.warning("JSON parse failed -> fallback mode used: %s", exc)
            return fallback_parse(raw_text, round_number=round_number)

    if not isinstance(parsed_payload, dict):
        logger.warning("JSON parse failed -> fallback mode used: parsed output is not an object")
        return fallback_parse(raw_text, round_number=round_number)

    try:
        if round_number == 1:
            payload = _normalize_round1(parsed_payload, raw_text)
        elif round_number == 2:
            payload = _normalize_round2(parsed_payload, raw_text)
        elif round_number == 3:
            payload = _normalize_round3(parsed_payload, raw_text)
        else:
            logger.warning("JSON parse failed -> fallback mode used: unsupported round %s", round_number)
            return fallback_parse(raw_text, round_number=round_number)
    except LLMParseError as exc:
        logger.warning("JSON parse failed -> fallback mode used: %s", exc)
        return fallback_parse(raw_text, round_number=round_number)

    short_summary = normalize_summary(
        _pick_string(payload, ["short_summary"]),
        _pick_string(payload, ["response", "main_argument", "conclusion"]),
    )
    display_content = _sanitize_text(_pick_string(payload, ["response", "main_argument", "conclusion"]))

    if not display_content:
        logger.warning("JSON parse failed -> fallback mode used: normalized output has no readable response")
        return fallback_parse(raw_text, round_number=round_number)

    payload["short_summary"] = short_summary
    payload["display_content"] = display_content
    payload["raw_content"] = raw_text
    payload["is_fallback"] = False

    return NormalizedRoundOutput(
        payload=payload,
        short_summary=short_summary,
        display_content=display_content,
        raw_content=raw_text,
        is_fallback=False,
    )


def fallback_parse(raw_text: str, round_number: int = 0) -> NormalizedRoundOutput:
    """Build a safe structured response from non-JSON model output."""
    extracted = _extract_best_jsonish_field(raw_text)
    paragraph_text = _sanitize_text(extracted or raw_text, preserve_paragraphs=True)
    cleaned_text = _sanitize_text(paragraph_text or extracted or raw_text)

    if not cleaned_text:
        cleaned_text = "Response generated, but could not be formatted."

    short_summary = generate_summary(cleaned_text, max_chars=_MAX_SUMMARY_CHARS)
    payload: dict[str, Any] = {
        "short_summary": short_summary,
        "response": cleaned_text,
        "display_content": cleaned_text,
        "is_fallback": True,
        "raw_content": raw_text,
    }

    if round_number == 1:
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
                "challenge": short_summary,
                "weakness_found": "The response was not structured, so the critique was formatted from the available text.",
                "counterargument": cleaned_text,
            }
        )
    elif round_number == 3:
        payload.update(_build_round3_fallback_fields(cleaned_text, paragraph_text))

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


def _build_round3_fallback_fields(cleaned_text: str, paragraph_text: str) -> dict[str, str]:
    paragraphs = _paragraphs(paragraph_text or cleaned_text)
    final_position = paragraphs[0] if paragraphs else generate_summary(cleaned_text)
    conclusion = paragraphs[-1] if paragraphs else final_position

    strongest_argument = _strongest_claim_sentence(cleaned_text) or generate_summary(cleaned_text)
    what_changed = _keyword_sentence(cleaned_text, _CHANGE_KEYWORDS) or "The final position weighs the strongest support against the main trade-offs raised in the debate."
    remaining_concerns = _keyword_sentence(cleaned_text, _CONCERN_KEYWORDS)

    return {
        "final_position": final_position,
        "what_changed": what_changed,
        "strongest_argument": strongest_argument,
        "remaining_concerns": remaining_concerns,
        "conclusion": conclusion,
    }


def _normalize_round1(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    response = _pick_string(payload, ["response", "main_argument", "stance", "text"])
    main_argument = _pick_string(payload, ["main_argument", "response", "stance"]) or response
    stance = _normalize_stance(_pick_string(payload, ["stance", "position", "final_position", "final_stance"]))

    key_points = _pick_string_list(payload, ["key_points"])
    risks = _pick_string_list(payload, ["risks_or_caveats", "risks"]) or []

    if not response:
        response = main_argument or _sanitize_text(raw_text)

    if not response:
        raise LLMParseError("Round 1 output missing response content.")

    short_summary = normalize_summary(
        _pick_string(payload, ["short_summary", "summary"]),
        response,
    )

    if not key_points:
        key_points = _derive_points_from_text(response)

    return {
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
    challenge = _pick_string(payload, ["challenge", "critique"]) or _pick_string(
        first_critique,
        ["challenge", "critique"],
    )
    weakness = _pick_string(payload, ["weakness_found", "weakness"]) or _pick_string(
        first_critique,
        ["weakness_found", "weakness"],
    )
    counter = _pick_string(payload, ["counterargument", "counter_evidence"]) or _pick_string(
        first_critique,
        ["counterargument", "counter_evidence"],
    )
    response = _pick_string(payload, ["response", "text", "challenge", "counterargument"])

    if not target_agent:
        target_agent = "General position"
    if not challenge:
        challenge = "The target response was unavailable, so this critique focuses on the general position."
    if not weakness:
        weakness = "The target argument lacks sufficient support or leaves key assumptions unaddressed."
    if not counter:
        counter = "A stronger position should address implementation constraints and provide clearer evidence."

    if not response:
        response = _sanitize_text(raw_text)
    if not response:
        response = f"{challenge} {counter}".strip()

    short_summary = normalize_summary(
        _pick_string(payload, ["short_summary", "summary"]),
        response,
    )

    return {
        "short_summary": short_summary,
        "target_agent": target_agent,
        "challenge": challenge,
        "weakness_found": weakness,
        "counterargument": counter,
        "response": response,
    }


def _normalize_round3(payload: dict[str, Any], raw_text: str) -> dict[str, Any]:
    final_position = _pick_string(payload, ["final_position", "final_stance", "stance", "conclusion"])
    what_changed = _pick_string(payload, ["what_changed"])
    strongest_argument = _pick_string(payload, ["strongest_argument", "main_argument", "challenge"])
    remaining_concerns = _pick_string(payload, ["remaining_concerns", "risks_or_caveats"]) 
    conclusion = _pick_string(payload, ["conclusion", "recommendation", "final_position"])
    response = _pick_string(payload, ["response", "text", "conclusion", "final_position"])

    if not response:
        response = _sanitize_text(raw_text)

    if not final_position:
        final_position = conclusion or _first_sentence(response)
    if not what_changed:
        what_changed = "The critique round refined the position by exposing assumptions and trade-offs."
    if not strongest_argument:
        strongest_argument = "The strongest argument was the one that best connected practical risks with clear policy trade-offs."
    if not remaining_concerns:
        remaining_concerns = "Important implementation and fairness concerns remain unresolved."
    if not conclusion:
        conclusion = final_position or _first_sentence(response)

    if not response:
        raise LLMParseError("Round 3 output missing response content.")

    short_summary = normalize_summary(
        _pick_string(payload, ["short_summary", "summary"]),
        response,
    )

    return {
        "short_summary": short_summary,
        "final_position": final_position or "Mixed",
        "what_changed": what_changed,
        "strongest_argument": strongest_argument,
        "remaining_concerns": remaining_concerns,
        "conclusion": conclusion,
        "response": response,
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
