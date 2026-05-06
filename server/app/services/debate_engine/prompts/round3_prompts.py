"""Round 3 — Final Synthesis prompts."""

from __future__ import annotations


def _compact_text(value: str, max_chars: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "…"


def _format_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return ""
    lines = ["\nRelevant document context (incorporate in your synthesis):\n"]
    for i, c in enumerate(chunks[:3], start=1):
        lines.append(f"[Source {i}]\n{_compact_text(c.get('content', ''), 260)}\n")
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
    debate_digest: str,
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
{_compact_text(original_stance, 260)}

Debate digest (Round 1 positions and Round 2 critiques):
{_compact_text(debate_digest, 1300)}
{knowledge_block}{context_block}
Your task: Generate your final synthesis for Round 3.

Reasoning style: {style_instruction}
{depth_instruction}

Output contract:
- Return only valid JSON.
- Do not use markdown fences.
- Do not mention JSON, schema, fields, or instructions.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- Every field must be user-facing content.
- short_summary must be one complete sentence.
- response must be clean prose for end users.
- Synthesis must explain what changed after critique and why.

Forbidden examples:
- "I need to create a JSON object..."
- "Generating JSON synthesis..."
- "Here is the JSON..."

Return only valid JSON in this exact format:
{{
    "short_summary": "<one complete sentence summarizing your final position>",
    "final_position": "<clear final stance after considering the debate>",
    "what_changed": "<what changed or was refined after Round 2>",
    "strongest_argument": "<strongest argument from the full debate>",
    "remaining_concerns": "<important unresolved concerns>",
    "conclusion": "<final concise conclusion>",
    "response": "<full readable synthesis>"
}}"""
