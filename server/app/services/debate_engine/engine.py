"""
Debate Engine — orchestrates a 3-round debate across multiple agents.

Step 1 stub: imports resolve, interface is defined.
Actual round execution is wired in Step 2.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class DebateEngine:
    """
    Orchestrates a full 3-round debate.

    Round 1 — Opening Statements (generate_round1)
    Round 2 — Cross Examination  (generate_round2)
    Round 3 — Final Synthesis    (generate_round3)
    """

    async def run_debate(
        self,
        question: str,
        agents: list[Any],
    ) -> dict[str, Any]:
        """
        Execute all 3 rounds for the given agents on the given question.

        Returns:
            {
                "round1": [...],   # list of per-agent opening statements
                "round2": [...],   # list of cross-examination exchanges
                "round3": [...],   # list of final synthesis per agent
            }
        """
        from app.services.debate_engine.round1 import generate_round1
        from app.services.debate_engine.round3 import generate_round3

        logger.info("Debate engine starting: question=%r, agents=%d", question[:80], len(agents))

        round1_results = await generate_round1(question=question, agents=agents)
        logger.info("Round 1 completed for %d agents.", len(round1_results))

        # Round 2 is implemented in Step 2
        round2_results: list[dict] = []
        logger.info("Round 2 skipped (not yet implemented).")

        round3_results = await generate_round3(
            question=question,
            agents=agents,
            round1_results=round1_results,
            round2_results=round2_results,
        )
        logger.info("Round 3 completed for %d agents.", len(round3_results))

        return {
            "round1": round1_results,
            "round2": round2_results,
            "round3": round3_results,
        }
