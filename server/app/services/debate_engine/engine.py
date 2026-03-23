"""
DebateEngine — orchestrates a full 3-round AI debate.

Usage:
    engine = DebateEngine()
    result = await engine.run_debate(question="...", agents=[agent1, agent2])

Returns:
    {
        "round1": [...],   # Opening statements
        "round2": [...],   # Cross-examination exchanges
        "round3": [...]    # Final syntheses
    }
"""

import logging
from typing import Any

from app.services.debate_engine.round1 import generate_round1
from app.services.debate_engine.round2 import generate_round2
from app.services.debate_engine.round3 import generate_round3

logger = logging.getLogger(__name__)


class DebateEngine:
    """
    Orchestrates a structured 3-round AI debate.

    • Round 1 — Each agent generates an opening statement (stance, key_points, confidence).
    • Round 2 — All agent pairs engage in cross-examination (challenge, response, rebuttal).
    • Round 3 — Each agent produces a final synthesis (final_stance, what_changed,
                remaining_concerns, recommendation).
    """

    async def run_debate(self, question: str, agents: list[Any]) -> dict:
        """
        Execute all three debate rounds sequentially.

        Each round's output is passed forward as context to subsequent rounds,
        allowing agents to build on what was said earlier.

        Args:
            question: The central debate question or proposition.
            agents:   List of Agent ORM objects with .id and .role attributes.

        Returns:
            Structured dict containing round1, round2, and round3 results.
        """
        if not agents:
            raise ValueError("A debate requires at least one agent.")

        logger.info("DebateEngine starting. Question: %s | Agents: %d", question, len(agents))

        round1 = await generate_round1(question=question, agents=agents)
        logger.info("Round 1 complete — %d opening statements.", len(round1))

        round2 = await generate_round2(question=question, agents=agents, round1_results=round1)
        logger.info("Round 2 complete — %d exchanges.", len(round2))

        round3 = await generate_round3(
            question=question,
            agents=agents,
            round1_results=round1,
            round2_results=round2,
        )
        logger.info("Round 3 complete — %d final syntheses.", len(round3))

        return {
            "round1": round1,
            "round2": round2,
            "round3": round3,
        }
