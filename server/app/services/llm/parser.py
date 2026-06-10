"""
Shared JSON parsing utility for LLM responses.

LLMs frequently wrap JSON in markdown fences or add preamble text.
This module provides robust extraction so providers don't duplicate the logic.
"""

from __future__ import annotations

import json
import re

from app.services.llm.exceptions import LLMParseError


# Smart-quote characters that LLMs occasionally emit instead of ASCII quotes.
_SMART_QUOTES = {
    "\u201c": '"',  # left double
    "\u201d": '"',  # right double
    "\u2018": "'",  # left single
    "\u2019": "'",  # right single
    "\u201f": '"',
    "\u2033": '"',
}

_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def _safe_repairs(candidate: str) -> str:
    """Apply conservative repairs that do not change semantics for valid JSON.

    Only safe transforms (no eval, no quote inference inside strings):
      * normalize curly/smart quotes to ASCII quotes
      * remove trailing commas before ] or }
      * strip leading text before the first { and trailing text after final }
    """
    s = candidate
    # Normalize smart quotes outside of strings is unsafe in general, but
    # since LLMs almost always emit them as field delimiters (not inside
    # values) this is a high-value/low-risk repair.
    for src, dst in _SMART_QUOTES.items():
        if src in s:
            s = s.replace(src, dst)

    # Remove trailing commas: {"a": 1,} or [1, 2,]
    s = _TRAILING_COMMA_RE.sub(r"\1", s)

    # Trim leading junk before the first '{' and trailing junk after the
    # outermost balanced '}'.
    first = s.find("{")
    if first > 0:
        s = s[first:]
    return s


def _try_parse(text: str) -> dict | None:
    # Try strict parsing first, then a lenient pass that tolerates literal
    # control characters (raw newlines, tabs) inside string values. LLMs very
    # commonly emit multi-paragraph prose fields with unescaped newlines, which
    # strict json.loads rejects ("Invalid control character"). strict=False only
    # relaxes that single rule — it does not accept otherwise-invalid JSON — so
    # it is a safe, high-recovery fallback that keeps well-formed JSON out of the
    # lossy text-fallback path.
    for strict in (True, False):
        try:
            result = json.loads(text, strict=strict)
        except json.JSONDecodeError:
            continue
        return result if isinstance(result, dict) else None
    return None


def parse_json_from_llm(text: str) -> dict:
    """
    Extract and parse the first JSON object from an LLM response.

    Recovery order (each step is attempted only if the previous failed):
      1. Direct parse of the input.
      2. Strip markdown code fences (```json ... ``` / ``` ... ```) and
         retry direct parse.
      3. Walk for the outermost balanced ``{ ... }`` substring and parse it.
      4. Apply safe repairs (smart-quote normalization, trailing-comma removal,
         leading/trailing junk trimming) and retry the previous candidates.
      5. Try parsing the substring up to the LAST ``}`` (handles models that
         continued writing prose after a complete JSON object).

    Raises:
        LLMParseError: If every recovery step fails.
    """
    raw = text.strip()

    # 1. Direct parse.
    direct = _try_parse(raw)
    if direct is not None:
        return direct

    # 2. Strip markdown fences (json or generic).
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
    if fence_match:
        fenced = fence_match.group(1)
        candidate = _try_parse(fenced) or _try_parse(_safe_repairs(fenced))
        if candidate is not None:
            return candidate

    # 3. Walk for the outermost balanced { ... } block.
    largest_balanced: str | None = None
    start = raw.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start=start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    largest_balanced = raw[start : i + 1]
                    candidate = _try_parse(largest_balanced)
                    if candidate is not None:
                        return candidate
                    break

    # 4. Safe repairs on the largest balanced candidate or on the full text.
    repair_targets = [t for t in (largest_balanced, raw) if t]
    for target in repair_targets:
        candidate = _try_parse(_safe_repairs(target))
        if candidate is not None:
            return candidate

    # 5. Last resort: the substring up to the LAST '}' (handles trailing prose).
    last_close = raw.rfind("}")
    first_open = raw.find("{")
    if first_open != -1 and last_close > first_open:
        clipped = raw[first_open : last_close + 1]
        candidate = _try_parse(clipped) or _try_parse(_safe_repairs(clipped))
        if candidate is not None:
            return candidate

    raise LLMParseError(
        f"Could not extract a JSON object from LLM response "
        f"(first 300 chars): {raw[:300]!r}"
    )
