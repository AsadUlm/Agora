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


def _knowledge_instruction(
    knowledge_mode: str,
    knowledge_strict: bool,
    has_chunks: bool,
) -> str:
    """Build knowledge-awareness instruction for the prompt."""
    if knowledge_mode == "no_docs":
        return "\nYou do not have access to any documents. Rely entirely on your reasoning and general knowledge.\n"
    if not has_chunks:
        return ""
    instruction = "\nUse the following documents as your primary source of truth. If unsure, explicitly say so.\n"
    if knowledge_strict:
        instruction += "IMPORTANT: Only answer using the provided documents. Do not rely on general knowledge.\n"
    return instruction


def build_opening_statement_prompt(
    role: str,
    question: str,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
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

    chunks = retrieved_chunks or []
    context_block = _format_context_block(chunks)
    knowledge_block = _knowledge_instruction(knowledge_mode, knowledge_strict, bool(chunks))

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}
{knowledge_block}{context_block}
Your task: Generate your opening statement for Round 1.

Reasoning style: {style_instruction}
{depth_instruction}

Respond ONLY with a valid JSON object in this exact format:
{{
  "stance": "<your clear position on the question>",
  "key_points": ["<point 1>", "<point 2>", "<point 3>"],
  "confidence": <float between 0.0 and 1.0>
}}"""
