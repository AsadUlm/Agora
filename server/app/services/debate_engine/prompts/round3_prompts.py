"""Round 3 — Final Synthesis prompts."""

from __future__ import annotations


def build_final_synthesis_prompt(
    role: str,
    question: str,
    original_stance: str,
    debate_summary: str,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
) -> str:
    """Build the prompt for an agent's Round 3 final synthesis."""
    depth_instruction = {
        "shallow": "Be concise. A few sentences per field.",
        "normal": "Be thorough. A short paragraph per field.",
        "deep": "Be exhaustive. Detailed analysis per field.",
    }.get(reasoning_depth, "Be thorough. A short paragraph per field.")

    style_instruction = {
        "analytical": "Reason analytically based on the evidence presented.",
        "creative": "Reflect creatively and consider unexpected insights.",
        "devil_advocate": "Acknowledge what challenged your position most.",
        "balanced": "Reflect in a balanced, nuanced way.",
    }.get(reasoning_style, "Reflect in a balanced, nuanced way.")

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}

Your original opening stance was:
{original_stance}

The full debate exchange (Round 2 cross-examination) was:
{debate_summary}

Your task: Generate your final synthesis for Round 3.

Reasoning style: {style_instruction}
{depth_instruction}

Respond ONLY with a valid JSON object in this exact format:
{{
  "final_stance": "<your final position after the full debate>",
  "what_changed": "<what arguments or exchanges changed your thinking, if any>",
  "remaining_concerns": "<unresolved issues or weaknesses in opposing arguments>",
  "recommendation": "<your final recommendation or conclusion>"
}}"""
