"""Round 1 — Opening Statement prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.debate_engine.prompts.reasoning_styles import style_instruction as _style_instruction
from app.services.debate_engine.prompts.quality_constraints import (
    ANTI_STRAWMAN_BLOCK,  # noqa: F401  (re-exported via prompts package)
    STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK,
    evidence_mode_block,
)
from app.services.retrieval.evidence import (
    EvidencePacket,
    format_evidence_block,
    format_evidence_usage_instructions,
)


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
    evidence_packets: list[EvidencePacket] | None = None,
) -> str:
    """Build the prompt for an agent's Round 1 opening statement."""
    depth_hint = {
        "shallow": "Be concise — 2-3 key points.",
        "normal": "Give 3-5 well-argued points.",
        "deep": "Give 5+ points with detailed reasoning.",
    }.get(reasoning_depth, "Give 3-5 well-argued points.")

    style_hint = _style_instruction("reason", reasoning_style)

    chunks = retrieved_chunks or []
    packets = evidence_packets or []
    has_evidence = bool(packets) or bool(chunks)
    if packets:
        context_block = (
            format_evidence_block(packets) + format_evidence_usage_instructions()
        )
    else:
        context_block = _format_context_block(chunks)
    knowledge_block = _knowledge_instruction(
        knowledge_mode, knowledge_strict, has_evidence
    )

    return f"""You are an expert panelist in a live debate, speaking to a human audience.
Argue the question directly — never narrate instructions, your role, output formatting, schemas, or your own process.

role: {role}.
{persona_block(role)}
Question: {question}
{knowledge_block}{context_block}
{evidence_mode_block(has_evidence)}
Round 1 is NOT for consensus — it is for presenting YOUR worldview. Begin from your own default stance and priority framework; do not move toward the other agents. Your opening MUST: (1) state a clear initial position consistent with your framework, (2) state the core assumptions it depends on, (3) explain your priority framework and the reasoning mechanism that makes it work (name a specific actor, threshold, or deployment context), (4) identify the concrete benefits you expect, (5) acknowledge at least one genuine weakness of your own position, and (6) state explicitly what evidence would change your mind. {depth_hint} {style_hint}. Back every claim with a concrete mechanism — avoid vague abstractions. Do not fabricate statistics; use qualitative phrasing instead.
Forbidden in Round 1: restating or rephrasing the question, neutral summaries, generic introductions, and convergence phrases such as "both sides have merit", "I generally agree with", "ultimately we all want", or "perhaps a balanced approach". Take the side your framework actually leads to and maximize viewpoint diversity.

Give your independent initial position. Do not reference critiques yet. Make your stance explicit.
{STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK}
Return only valid JSON. No markdown fences. Do not mention JSON, schema, fields, or instructions in your answer. Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
Forbidden: "I need to create a JSON object..."
{{
    "one_sentence_takeaway": "<your core claim in 15-25 words>",
    "short_summary": "<2 sentences adding a supporting reason the takeaway omits>",
    "stance": "Supports | Opposes | Conditional | Mixed | Unclear",
    "priority_framework": "<the outcome you optimize and why it ranks first>",
    "main_argument": "<thesis and its core mechanism, one paragraph>",
    "assumptions": ["<assumption your position depends on>"],
    "key_points": ["<point 1>", "<point 2>", "<point 3>"],
    "expected_benefits": ["<concrete benefit you expect>"],
    "risks_or_caveats": ["<risk or caveat>"],
    "acknowledged_weakness": "<one genuine weakness of your own position>",
    "what_would_change_my_mind": "<the specific evidence that would move your position>",
    "response": "<full argument in prose, 300-500 words — not a summary, not a list>"
}}"""
