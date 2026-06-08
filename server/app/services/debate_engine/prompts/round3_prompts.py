"""Round 3 — Final Synthesis prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.debate_engine.prompts.reasoning_styles import style_instruction as _style_instruction
from app.services.debate_engine.prompts.quality_constraints import (
    evidence_mode_block,
)
from app.services.retrieval.evidence import (
    EvidencePacket,
    format_evidence_block,
    format_evidence_usage_instructions,
)


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
    evidence_packets: list[EvidencePacket] | None = None,
) -> str:
    """Build the prompt for an agent's Round 3 final synthesis."""
    depth_instruction = {
        "shallow": "Be concise. A few sentences per field.",
        "normal": "Be thorough. A short paragraph per field.",
        "deep": "Be exhaustive. Detailed analysis per field.",
    }.get(reasoning_depth, "Be thorough. A short paragraph per field.")

    style_instruction = _style_instruction("synthesize", reasoning_style)

    context_block = (
        format_evidence_block(evidence_packets) + format_evidence_usage_instructions()
        if evidence_packets
        else _format_context_block(retrieved_chunks or [])
    )
    knowledge_block = _knowledge_instruction(
        knowledge_mode,
        knowledge_strict,
        bool(evidence_packets or retrieved_chunks or []),
    )

    return f"""You are an expert panelist delivering a closing synthesis to a human audience.
Resolve the debate with intellectual rigour — never narrate instructions, your role, output formatting, schemas, or your own process.

role: {role}.
{persona_block(role)}
Question: {question}

Your opening stance: {_compact_text(original_stance, 260)}

Debate digest (Round 1 positions and Round 2 critiques):
{_compact_text(debate_digest, 1300)}
{knowledge_block}{context_block}
{evidence_mode_block(bool(evidence_packets or retrieved_chunks or []))}
Do not simply repeat your opening position. First evaluate the debate: which critique survived, which assumption failed, which argument got stronger, and whether your own position should change. Then state a position update — exactly one of: Strengthened, Refined, Partially Revised, or Reversed. Your update MUST be earned: explicitly reference the specific critique you received, the assumption that was challenged, or the evidence you accepted. No generic updates — if nothing was challenged, your position is Strengthened and you must say why. Synthesize across the agents' strongest arguments. Take a strong final stance — not a compromise or average. Identify the winning argument and the losing argument. Explain what changed after the critique round. Write like a final conclusion for a human reader. Do NOT describe your process. {depth_instruction} {style_instruction}. Back every claim with a concrete mechanism. Do not fabricate statistics — use qualitative phrasing.

Return only valid JSON. No markdown fences. Do not mention JSON, schema, fields, or instructions in your answer. Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
{{
    "one_sentence_takeaway": "<final position in 15-25 words>",
    "short_summary": "<2 sentences adding a supporting reason the takeaway omits>",
    "final_position": "<clear final stance, or explicit 'no resolution because ...' if none>",
    "position_update": "Strengthened | Refined | Partially Revised | Reversed",
    "position_update_basis": "<the specific critique, challenged assumption, or accepted evidence that earned this update>",
    "key_tradeoff": "<the key trade-off that decided this position>",
    "winning_argument": "<the argument that prevailed and why>",
    "losing_argument": "<the strongest argument that did not prevail and why>",
    "confidence": "low | medium | high",
    "what_changed": "<what changed or was refined after Round 2, and why your position update is what it is>",
    "strongest_argument": "<strongest argument from the full debate>",
    "remaining_concerns": "<important unresolved concerns>",
    "conclusion": "<final concise conclusion>",
    "response": "<full synthesis essay in prose, 400-700 words>"
}}"""
