"""Round 2 — Cross Examination prompts."""

from __future__ import annotations


def build_critique_prompt(
    role: str,
    question: str,
    own_stance: str,
    other_agents: list[dict],  # [{"role": str, "stance": str, "key_points": list[str]}]
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
) -> str:
    """
    Build the Round 2 prompt for an agent critiquing all other agents.

    Args:
        role:         This agent's role label.
        question:     The central debate question.
        own_stance:   This agent's Round 1 stance (for context).
        other_agents: List of other agents' Round 1 outputs to critique.
        reasoning_style: How this agent reasons.
        reasoning_depth: How deeply to critique.
    """
    depth_instruction = {
        "shallow": "Be concise. One focused challenge per opponent.",
        "normal": "Be substantive. Identify the core weakness per opponent (2-3 sentences each).",
        "deep": "Be rigorous. Dissect each argument thoroughly, cite logical fallacies or missing evidence.",
    }.get(reasoning_depth, "Be substantive.")

    style_instruction = {
        "analytical": "Critique analytically — focus on logical consistency and evidence gaps.",
        "creative": "Challenge creatively — expose hidden assumptions and alternative framings.",
        "devil_advocate": "Challenge aggressively — find the sharpest weakness in each argument.",
        "balanced": "Critique fairly — acknowledge strengths before identifying weaknesses.",
    }.get(reasoning_style, "Critique fairly.")

    # Format other agents' stances
    opponents_block = ""
    for i, agent in enumerate(other_agents, start=1):
        key_pts = "\n".join(f"    - {pt}" for pt in agent.get("key_points", []))
        opponents_block += (
            f"\nOpponent {i} — {agent['role']}:\n"
            f"  Stance: {agent.get('stance', '(no stance provided)')}\n"
            f"  Key points:\n{key_pts or '    (none provided)'}\n"
        )

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}

Your own opening stance was: {own_stance}

Your task: Critique the following opponents' arguments in Round 2 Cross-Examination.

{opponents_block}

Critique style: {style_instruction}
{depth_instruction}

For each opponent, identify their weakest argument, challenge it directly, and explain the flaw.

Respond ONLY with a valid JSON object in this exact format:
{{
  "critiques": [
    {{
      "target_role": "<opponent's role>",
      "challenge": "<your direct challenge to their argument>",
      "weakness": "<the core flaw or gap you identified>",
      "counter_evidence": "<any evidence or reasoning that refutes them>"
    }}
  ]
}}"""
