"""Round 1 — Opening Statement prompts."""

from __future__ import annotations


def build_opening_statement_prompt(
    role: str,
    question: str,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
) -> str:
    """Build the prompt for an agent's Round 1 opening statement."""
    depth_instruction = {
        "shallow": "Be concise. 2-3 key points only.",
        "normal": "Be thorough. Provide 3-5 well-argued key points.",
        "deep": "Be exhaustive. Provide 5+ key points with detailed reasoning.",
    }.get(reasoning_depth, "Be thorough. Provide 3-5 well-argued key points.")

    style_instruction = {
        "analytical": "Reason analytically. Focus on evidence and logical structure.",
        "creative": "Reason creatively. Explore unconventional angles and possibilities.",
        "devil_advocate": "Take a contrarian position. Challenge assumptions aggressively.",
        "balanced": "Reason in a balanced way. Acknowledge multiple perspectives.",
    }.get(reasoning_style, "Reason in a balanced way.")

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}

Your task: Generate your opening statement for Round 1.

Reasoning style: {style_instruction}
{depth_instruction}

Respond ONLY with a valid JSON object in this exact format:
{{
  "stance": "<your clear position on the question>",
  "key_points": ["<point 1>", "<point 2>", "<point 3>"],
  "confidence": <float between 0.0 and 1.0>
}}"""
