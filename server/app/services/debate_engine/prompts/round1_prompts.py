"""Round 1 — Opening Statement prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block


def _compact_chunk_text(text: str, max_chars: int = 260) -> str:
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "…"


def _format_context_block(chunks: list[dict]) -> str:
    """
    Render retrieved document chunks as an indented text block.
    chunks: list of {content: str, similarity_score: float}
    Returns empty string when chunks is empty (no-op for the prompt).
    """
    if not chunks:
        return ""
    lines = ["\nRelevant document context (use this to ground your arguments):\n"]
    for i, c in enumerate(chunks[:3], start=1):
        lines.append(f"[Source {i}]\n{_compact_chunk_text(c.get('content', ''))}\n")
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
{persona_block(role)}
The debate question is: {question}
{knowledge_block}{context_block}
Your task: Generate your opening statement for Round 1.

Reasoning style: {style_instruction}
{depth_instruction}

Quality requirements (mandatory):
- Use at least one CONCRETE example, domain reference, or scenario.
- Avoid restating the question and avoid generic abstractions.
- Anchor each key_point to a specific mechanism, actor, or outcome.

Output contract:
- Return only valid JSON.
- Do not use markdown fences.
- Do not mention JSON, schema, fields, or instructions.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- Every field must be user-facing content.
- one_sentence_takeaway must be ONE complete sentence (15-25 words) that captures your core claim. Never truncate.
- short_summary must mirror one_sentence_takeaway (kept for backward compatibility).
- response must be clean prose for end users.

Forbidden examples:
- "I need to create a JSON object..."
- "Generating JSON synthesis..."
- "Here is the JSON..."

Return only valid JSON in this exact format:
{{
    "one_sentence_takeaway": "<ONE complete sentence, 15-25 words, captures core claim>",
    "short_summary": "<same sentence as one_sentence_takeaway>",
    "stance": "Supports | Opposes | Mixed | Conditional",
    "main_argument": "<clean paragraph>",
    "key_points": ["<point 1>", "<point 2>", "<point 3>"],
    "risks_or_caveats": ["<risk or caveat>", "<optional second caveat>"],
    "response": "<full user-facing answer>"
}}

Good example:
{{
    "one_sentence_takeaway": "The analyst supports targeted AI regulation because high-risk systems can create harms that markets may not prevent.",
    "short_summary": "The analyst supports targeted AI regulation because high-risk systems can create harms that markets may not prevent.",
    "stance": "Supports",
    "main_argument": "High-risk AI systems can create systemic harms, so regulation should focus on safety-critical use cases rather than blanket restrictions.",
    "key_points": [
        "High-risk AI systems can affect public safety and rights.",
        "Market incentives may not fully account for external harms.",
        "Regulation should be risk-based rather than universal."
    ],
    "risks_or_caveats": [
        "Overly broad rules could slow useful innovation."
    ],
    "response": "I support targeted AI regulation for high-risk systems. The strongest case is that safety-critical deployments can produce harms that markets alone may not prevent, so policy should focus on those contexts while avoiding blanket restrictions."
}}"""
