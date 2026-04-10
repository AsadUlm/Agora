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

    async def generate_structured(self, prompt: str) -> dict:
        return dict(_MOCK_STRUCTURED)

