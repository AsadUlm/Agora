"""
Round 3 — Final Synthesis.

Each agent reflects on the full debate (their Round 1 stance + all Round 2 exchanges)
and produces:
  • final_stance
  • what_changed
  • remaining_concerns
  • recommendation
"""

import asyncio
import logging
from typing import Any

from app.schemas.agent_config import AgentConfig
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt
from app.services.llm.exceptions import LLMError
from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


def _build_debate_summary(round2_results: list[dict]) -> str:
    """
    Render the Round 2 exchanges as a readable plain-text block for inclusion
    in the Round 3 prompt.
    """
    if not round2_results:
        return "No cross-examination exchanges occurred."

    lines: list[str] = []
    for i, ex in enumerate(round2_results, start=1):
        lines.append(
            f"Exchange {i} — {ex['challenger_role']} vs {ex['responder_role']}:\n"
            f"  Challenge : {ex['challenge']}\n"
            f"  Response  : {ex['response']}\n"
            f"  Rebuttal  : {ex['rebuttal']}"
        )
    return "\n\n".join(lines)


async def generate_round3(
    question: str,
    agents: list[Any],
    round1_results: list[dict],
    round2_results: list[dict],
) -> list[dict]:
    """
    Run Round 3 — final synthesis for all agents concurrently.

    Args:
        question:       The central debate question.
        agents:         Agent ORM objects (require .id and .role).
        round1_results: Output of generate_round1.
        round2_results: Output of generate_round2.

    Returns:
        List of synthesis dicts, one per agent.
    """
    debate_summary = _build_debate_summary(round2_results)
    round1_by_agent_id = {r["agent_id"]: r for r in round1_results}

    llm = get_llm_service()

    async def _generate_synthesis(agent: Any) -> dict:
        agent_id_str = str(agent.id)
        original = round1_by_agent_id.get(agent_id_str, {})
        original_stance = original.get("stance", "No opening stance was recorded.")

        raw_cfg = getattr(agent, "config", None) or {}
        parsed_raw = raw_cfg.get("_parsed")
        reasoning_style = getattr(agent, "reasoning_style", None)
        if reasoning_style is not None:
            cfg = AgentConfig()
            cfg.reasoning.style = reasoning_style or "balanced"
        elif parsed_raw:
            cfg = AgentConfig.model_validate(parsed_raw)
        else:
            cfg = AgentConfig.from_raw(raw_cfg)

        prompt = build_final_synthesis_prompt(
            role=agent.role,
            question=question,
            original_stance=original_stance,
            debate_summary=debate_summary,
            reasoning_style=cfg.reasoning.style,
            reasoning_depth=cfg.reasoning.depth,
        )
        try:
            parsed = await llm.generate_structured(prompt)
        except LLMError as exc:
            logger.exception("Round 3 LLM failure for agent %s (%s)", agent.id, agent.role)
            return {
                "agent_id": agent_id_str,
                "role": agent.role,
                "final_stance": "",
                "what_changed": "",
                "remaining_concerns": "",
                "recommendation": "",
                "generation_status": "failed",
                "error": str(exc),
            }
        return {
            "agent_id": agent_id_str,
            "role": agent.role,
            "final_stance": parsed.get("final_stance", ""),
            "what_changed": parsed.get("what_changed", ""),
            "remaining_concerns": parsed.get("remaining_concerns", ""),
            "recommendation": parsed.get("recommendation", ""),
            "generation_status": "success",
        }

    results = await asyncio.gather(*[_generate_synthesis(a) for a in agents])
    return list(results)
