"""
JSON parsing utilities for LLM output.

LLMs occasionally wrap JSON in markdown fences or add commentary even when
instructed not to. This module centralises all parsing and recovery logic
so individual providers and callers stay clean.

Parsing waterfall:
    1. Direct parse (fast path — works for well-behaved responses)
    2. Strip markdown code fences  (```json … ``` or ``` … ```)
    3. Extract first {...} block found anywhere in the text
    4. Return ({}, error_message) — callers (LLMService) raise LLMParsingError
"""

import json
import logging
import re

logger = logging.getLogger(__name__)

# Pre-compiled patterns for efficiency
_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
_BRACE_RE = re.compile(r"\{.*\}", re.DOTALL)


def extract_json(text: str) -> tuple[dict, str | None]:
    """
    Attempt to extract a JSON object from an LLM response string.

    Args:
        text: Raw string returned by the LLM provider.

    Returns:
        A (parsed_dict, error_message) tuple.
        On success: (dict, None)
        On failure: ({}, error_message)
    """
    if not text or not text.strip():
        return {}, "Empty response from provider."

    stripped = text.strip()

    # ── 1. Direct parse ──────────────────────────────────────────────────
    try:
        return json.loads(stripped), None
    except json.JSONDecodeError:
        pass

    # ── 2. Strip markdown code fences ───────────────────────────────────
    fence_match = _FENCE_RE.search(stripped)
    if fence_match:
        try:
            return json.loads(fence_match.group(1)), None
        except json.JSONDecodeError:
            pass

    # ── 3. Extract first {...} block ─────────────────────────────────────
    brace_match = _BRACE_RE.search(stripped)
    if brace_match:
        try:
            return json.loads(brace_match.group(0)), None
        except json.JSONDecodeError:
            pass

    # ── 4. All attempts failed ───────────────────────────────────────────
    preview = stripped[:200]
    error = f"Unable to extract valid JSON. Response preview: {preview!r}"
    logger.warning("JSON extraction failed. Raw (first 300 chars): %.300s", stripped)
    return {}, error
