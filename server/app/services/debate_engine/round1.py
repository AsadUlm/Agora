"""
Round 1 — Opening Statements.

Each agent independently generates:
  • stance
  • key_points (3–5)
  • confidence (0.0 – 1.0)
"""

import asyncio
import logging
from typing import Any

from app.schemas.agent_config import AgentConfig
from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.llm.exceptions import LLMError
from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


def _get_agent_config(agent: Any) -> AgentConfig:
    """Extract typed AgentConfig from the agent's raw JSONB config."""
    raw = getattr(agent, "config", None) or {}
    parsed = raw.get("_parsed")
    if parsed:
        return AgentConfig.model_validate(parsed)
    return AgentConfig.from_raw(raw)


async def generate_round1(question: str, agents: list[Any]) -> list[dict]:
    """
    Run Round 1 for all agents concurrently.

    Args:
        question: The central debate question.
        agents:   List of Agent ORM objects (require .id and .role).

    Returns:
        List of dicts, one per agent, containing opening-statement fields.
    """
    llm = get_llm_service()

    async def _generate_for_agent(agent: Any) -> dict:
        cfg = _get_agent_config(agent)
        prompt = build_opening_statement_prompt(
            role=agent.role,
            question=question,
            reasoning_style=cfg.reasoning.style,
            reasoning_depth=cfg.reasoning.depth,
        )
        try:
            parsed = await llm.generate_structured(prompt)
        except LLMError as exc:
            logger.exception("Round 1 LLM failure for agent %s (%s)", agent.id, agent.role)
            return {
                "agent_id": str(agent.id),
                "role": agent.role,
                "stance": "",
                "key_points": [],
                "confidence": 0.0,
                "generation_status": "failed",
                "error": str(exc),
            }
        return {
            "agent_id": str(agent.id),
            "role": agent.role,
            "stance": parsed.get("stance", ""),
            "key_points": parsed.get("key_points", []),
            "confidence": parsed.get("confidence", 0.0),
            "generation_status": "success",
        }

    results = await asyncio.gather(*[_generate_for_agent(a) for a in agents])
    return list(results)
