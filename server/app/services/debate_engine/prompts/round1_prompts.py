"""Round 1 — Opening Statement prompts."""

from __future__ import annotations


def _format_context_block(chunks: list[dict]) -> str:
    """
    Render retrieved document chunks as an indented text block.
    chunks: list of {content: str, similarity_score: float}
    Returns empty string when chunks is empty (no-op for the prompt).
    """
    if not chunks:
        return ""
    lines = ["\nRelevant document context (use this to ground your arguments):\n"]
    for i, c in enumerate(chunks, start=1):
        lines.append(f"[Source {i}]\n{c['content']}\n")
    return "\n".join(lines)


def build_opening_statement_prompt(
    role: str,
    question: str,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
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

    context_block = _format_context_block(retrieved_chunks or [])

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}
{context_block}
Your task: Generate your opening statement for Round 1.

Reasoning style: {style_instruction}
{depth_instruction}

Respond ONLY with a valid JSON object in this exact format:
{{
  "stance": "<your clear position on the question>",
  "key_points": ["<point 1>", "<point 2>", "<point 3>"],
  "confidence": <float between 0.0 and 1.0>
}}"""
