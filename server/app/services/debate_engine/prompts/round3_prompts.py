"""Round 3 — Final Synthesis prompts."""

from __future__ import annotations


def _format_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return ""
    lines = ["\nRelevant document context (incorporate in your synthesis):\n"]
    for i, c in enumerate(chunks, start=1):
        lines.append(f"[Source {i}]\n{c['content']}\n")
    return "\n".join(lines)


def _knowledge_instruction(
    knowledge_mode: str,
    knowledge_strict: bool,
    has_chunks: bool,
) -> str:
    if knowledge_mode == "no_docs":
        return "\nYou do not have access to any documents. Base your final synthesis on reasoning alone.\n"
    if not has_chunks:
        return ""
    instruction = "\nUse the following documents as your primary source of truth in your final synthesis. If unsure, explicitly say so.\n"
    if knowledge_strict:
        instruction += "IMPORTANT: Only answer using the provided documents. Do not rely on general knowledge.\n"
    return instruction


def build_final_synthesis_prompt(
    role: str,
    question: str,
    original_stance: str,
    debate_summary: str,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
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

    context_block = _format_context_block(retrieved_chunks or [])
    knowledge_block = _knowledge_instruction(knowledge_mode, knowledge_strict, bool(retrieved_chunks or []))

    return f"""You are a debate participant with the role: {role}.

The debate question is: {question}

Your original opening stance was:
{original_stance}

The full debate exchange (Round 2 cross-examination) was:
{debate_summary}
{knowledge_block}{context_block}
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
