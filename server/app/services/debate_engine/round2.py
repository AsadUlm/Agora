"""
Round 2 — Cross-Examination / Direct Debate.

Selects the most conflicting agent pairs from Round 1 using a deterministic
scoring algorithm and generates a structured exchange containing:
  • challenge
  • response
  • rebuttal
"""

import asyncio
import logging
from typing import Any

from app.services.debate_engine.conflict_selector import select_conflict_pairs
from app.services.debate_engine.prompts.round2_prompts import build_cross_debate_prompt
from app.services.llm.exceptions import LLMError
from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


async def generate_round2(
    question: str,
    agents: list[Any],  # noqa: ARG001 — kept for API symmetry with round1/round3
    round1_results: list[dict],
) -> list[dict]:
    """
    Run Round 2 — cross-examination for all conflicting pairs concurrently.

    Args:
        question:       The central debate question.
        agents:         Agent ORM objects (unused here but kept for API consistency).
        round1_results: The output of generate_round1.

    Returns:
        List of exchange dicts, one per (challenger, responder) pair.
    """
    pairs = select_conflict_pairs(round1_results)

    llm = get_llm_service()

    async def _generate_exchange(challenger: dict, responder: dict) -> dict:
        prompt = build_cross_debate_prompt(
            challenger_role=challenger["role"],
            responder_role=responder["role"],
            challenger_stance=challenger["stance"],
            responder_stance=responder["stance"],
            question=question,
        )
        try:
            parsed = await llm.generate_structured(prompt)
        except LLMError as exc:
            logger.exception(
                "Round 2 LLM failure: %s vs %s",
                challenger["role"],
                responder["role"],
            )
            return {
                "challenger_agent_id": challenger["agent_id"],
                "challenger_role": challenger["role"],
                "responder_agent_id": responder["agent_id"],
                "responder_role": responder["role"],
                "challenge": "",
                "response": "",
                "rebuttal": "",
                "generation_status": "failed",
                "error": str(exc),
            }
        return {
            "challenger_agent_id": challenger["agent_id"],
            "challenger_role": challenger["role"],
            "responder_agent_id": responder["agent_id"],
            "responder_role": responder["role"],
            "challenge": parsed.get("challenge", ""),
            "response": parsed.get("response", ""),
            "rebuttal": parsed.get("rebuttal", ""),
            "generation_status": "success",
        }

    results = await asyncio.gather(*[_generate_exchange(c, r) for c, r in pairs])
    return list(results)
