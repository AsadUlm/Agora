"""Prompt builders for Round 3 — Final Synthesis."""


def build_final_synthesis_prompt(
    role: str,
    question: str,
    original_stance: str,
    debate_summary: str,
) -> str:
    """
    Construct the prompt that asks an agent to produce its final synthesis.

    Args:
        role:            The agent's role.
        question:        The central debate question.
        original_stance: The stance the agent took in Round 1.
        debate_summary:  A plain-text summary of the Round 2 exchanges.

    Returns:
        A fully rendered prompt string ready to be sent to the LLM.
    """
    return f"""RESPONSE FORMAT
- Respond with a SINGLE valid JSON object.
- No markdown. No code fences. No text before or after the JSON.
- Do not include comments inside the JSON.

ROLE
You are a {role} completing a structured AI debate.

DEBATE QUESTION
"{question}"

YOUR ORIGINAL STANCE (Round 1)
"{original_stance}"

ROUND 2 EXCHANGES SUMMARY
{debate_summary}

TASK
Having reviewed the full debate, produce your final synthesis:
{{
    "final_stance": "<Your refined final position on the question after the debate>",
    "what_changed": "<What aspects of your view were strengthened, weakened, or nuanced>",
    "remaining_concerns": "<Open questions or concerns not fully resolved by the debate>",
    "recommendation": "<Your concrete, actionable recommendation or conclusion>"
}}

CONSTRAINTS
- Reflect genuinely on whether the debate changed your position.
- Each field: single coherent paragraph, 2–4 sentences.
- Write entirely from the perspective of a {role}.
- Output the JSON object and nothing else."""

