"""
Mock LLM provider.

Returns deterministic, schema-valid JSON responses for each debate round.
Used for:
  • Local development without API keys
  • Automated tests
  • CI / CD pipelines

Selection: set LLM_PROVIDER=mock in .env (this is the default).
"""

import json
import logging

from app.services.llm.base import LLMProvider

logger = logging.getLogger(__name__)

# ── Static response fixtures ─────────────────────────────────────────────────

_ROUND1_RESPONSE = {
    "stance": (
        "Based on available evidence, a balanced and data-driven approach "
        "is the most effective path forward on this question."
    ),
    "key_points": [
        "The empirical evidence strongly supports a structured framework.",
        "Historical precedent demonstrates consistent outcomes under similar conditions.",
        "Stakeholder alignment is critical to sustainable implementation.",
        "Risk assessment must precede any large-scale commitment.",
        "Iterative evaluation ensures adaptability over time.",
    ],
    "confidence": 0.78,
}

_ROUND2_RESPONSE = {
    "challenge": (
        "The opposing position underestimates the systemic risks embedded in "
        "rapid implementation without adequate safeguards."
    ),
    "response": (
        "While the concern is noted, the proposed framework explicitly accounts "
        "for risk mitigation through phased rollout and continuous monitoring."
    ),
    "rebuttal": (
        "The phased approach is insufficient given the scale of interdependencies; "
        "a more conservative baseline is warranted before escalation."
    ),
}

_ROUND3_RESPONSE = {
    "final_stance": (
        "The core position remains valid, though the debate has surfaced "
        "important nuances regarding implementation timelines and risk thresholds."
    ),
    "what_changed": (
        "The cross-examination revealed that the original confidence level was "
        "slightly overstated; a more cautious optimism is appropriate."
    ),
    "remaining_concerns": (
        "The long-term second-order effects remain insufficiently modeled, "
        "and external dependency risks need further analysis."
    ),
    "recommendation": (
        "Proceed with a controlled pilot program, establish clear success metrics, "
        "and conduct a formal review at the 6-month milestone before full deployment."
    ),
}

_FALLBACK_RESPONSE = {
    "result": "Mock LLM response.",
}

# ── Keywords used to detect which round is being served ─────────────────────

_ROUND1_KEYWORDS = {"opening statement", "round 1", "key_points", "confidence"}
_ROUND2_KEYWORDS = {"challenge", "cross-examination", "round 2", "rebuttal"}
_ROUND3_KEYWORDS = {"final", "synthesis", "round 3", "what_changed", "recommendation"}


def _detect_round(prompt_lower: str) -> dict:
    if any(kw in prompt_lower for kw in _ROUND1_KEYWORDS):
        return _ROUND1_RESPONSE
    if any(kw in prompt_lower for kw in _ROUND2_KEYWORDS):
        return _ROUND2_RESPONSE
    if any(kw in prompt_lower for kw in _ROUND3_KEYWORDS):
        return _ROUND3_RESPONSE
    return _FALLBACK_RESPONSE


class MockProvider(LLMProvider):
    """
    Deterministic provider that returns pre-defined JSON for each round type.
    No network calls are made.
    """

    async def generate(self, prompt: str) -> str:
        logger.debug("MockProvider: returning fixture response.")
        response = _detect_round(prompt.lower())
        return json.dumps(response)

    @property
    def provider_name(self) -> str:
        return "mock"
