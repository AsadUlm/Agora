"""
Round 2 — Cross Examination.

Each agent critiques every other agent's Round 1 opening statement.
Agents run concurrently.

Returns:
    List of dicts, one per agent, each containing their critique of all opponents.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.schemas.agent_config import AgentConfig
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.llm.exceptions import LLMError
from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


async def generate_round2(
    question: str,
    agents: list[Any],
    round1_results: list[dict],
) -> list[dict]:
    """
    Run Round 2 for all agents concurrently.

    Args:
        question:       The central debate question.
        agents:         Agent ORM objects (require .id and .role).
        round1_results: Output list from generate_round1/execute_round_1.

    Returns:
        List of dicts, one per agent, containing their critique of opponents.
    """
    llm = get_llm_service()

    # Build lookup: agent_id → round1 result
    r1_by_id = {r["agent_id"]: r for r in round1_results}

    async def _critique_for_agent(agent: Any) -> dict:
        agent_id_str = str(agent.id)

        # This agent's own r1 result
        own_r1 = r1_by_id.get(agent_id_str, {})
        own_stance = own_r1.get("stance", "No opening stance recorded.")

        # Other agents' r1 results (everyone except self)
        other_agents_r1 = [
            {
                "role": r.get("role", "unknown"),
                "stance": r.get("stance", ""),
                "key_points": r.get("key_points", []),
            }
            for r in round1_results
            if r.get("agent_id") != agent_id_str
        ]

        if not other_agents_r1:
            # Only one agent — nothing to critique
            return {
                "agent_id": agent_id_str,
                "role": agent.role,
                "critiques": [],
                "generation_status": "skipped",
                "reason": "No opponents to critique.",
            }

        # Get agent reasoning style
        reasoning_style = getattr(agent, "reasoning_style", None) or "balanced"
        cfg = AgentConfig()
        cfg.reasoning.style = reasoning_style

        prompt = build_critique_prompt(
            role=agent.role,
            question=question,
            own_stance=own_stance,
            other_agents=other_agents_r1,
            reasoning_style=cfg.reasoning.style,
            reasoning_depth=cfg.reasoning.depth,
        )

        try:
            parsed = await llm.generate_structured(prompt)
        except LLMError as exc:
            logger.exception(
                "Round 2 LLM failure for agent %s (%s): %s",
                agent.id,
                agent.role,
                exc,
            )
            return {
                "agent_id": agent_id_str,
                "role": agent.role,
                "critiques": [],
                "generation_status": "failed",
                "error": str(exc),
            }

        return {
            "agent_id": agent_id_str,
            "role": agent.role,
            "critiques": parsed.get("critiques", []),
            "generation_status": "success",
        }

    tasks = [_critique_for_agent(agent) for agent in agents]
    return await asyncio.gather(*tasks)
