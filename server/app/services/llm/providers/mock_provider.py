"""
Mock LLM provider — used in tests and when no API key is configured.

Returns deterministic structured responses without making real API calls.
"""

from __future__ import annotations

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.llm.service import LLMService

_MOCK_STRUCTURED = {
    # Round 1 fields
    "stance": "Mock stance: this topic has multiple valid perspectives.",
    "key_points": [
        "First key argument supporting the position.",
        "Second key argument with evidence.",
        "Third key argument addressing counterpoints.",
    ],
    "confidence": 0.75,
    # Round 2 fields
    "critiques": [
        {
            "target_role": "opponent",
            "challenge": "The opposing argument lacks empirical support.",
            "weakness": "Relies on anecdotal evidence rather than data.",
        }
    ],
    # Round 3 fields
    "final_stance": "After debate, the position remains largely unchanged but refined.",
    "what_changed": "The critique round highlighted nuances not initially considered.",
    "remaining_concerns": "The opposing view raises valid points on implementation.",
    "recommendation": "A balanced approach incorporating both perspectives is optimal.",
    # Readable body shared across rounds so normalization yields real content.
    "main_argument": "A balanced, evidence-based position is the strongest overall.",
    "conclusion": "On balance, a measured approach best serves the question at hand.",
    "response": (
        "On balance, this question is best answered with a measured, "
        "evidence-based approach: the strongest arguments on each side point "
        "toward a balanced position that weighs benefits against risks rather "
        "than adopting either extreme."
    ),
}


class MockProvider(LLMService):
    """Deterministic mock: returns a valid structured response for any round."""

    async def generate(self, request: LLMRequest) -> LLMResponse:
        import json
        return LLMResponse(
            content=json.dumps(_MOCK_STRUCTURED),
            prompt_tokens=10,
            completion_tokens=50,
            latency_ms=1,
        )

