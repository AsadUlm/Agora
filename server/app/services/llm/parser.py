"""
Shared JSON parsing utility for LLM responses.

LLMs frequently wrap JSON in markdown fences or add preamble text.
This module provides robust extraction so providers don't duplicate the logic.
"""

from __future__ import annotations

import json
import re

from app.services.llm.exceptions import LLMParseError


def parse_json_from_llm(text: str) -> dict:
    """
    Extract and parse the first JSON object from an LLM response.

    Handles:
    - Plain JSON string
    - JSON wrapped in ```json ... ``` markdown fences
    - JSON preceded or followed by explanatory text
    - Nested objects (finds the outermost complete object)

    Raises:
        LLMParseError: If no valid JSON object can be extracted.
    """
    text = text.strip()

    # 1. Try direct parse first (most common for models with JSON mode)
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # 2. Markdown code fence: ```json ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        try:
            result = json.loads(fence_match.group(1))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    # 3. Find the outermost { ... } block in the text
    start = text.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start=start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : i + 1]
                    try:
                        result = json.loads(candidate)
                        if isinstance(result, dict):
                            return result
                    except json.JSONDecodeError:
                        break

    raise LLMParseError(
        f"Could not extract a JSON object from LLM response "
        f"(first 300 chars): {text[:300]!r}"
    )
