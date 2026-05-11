"""Round 3 — Final Synthesis prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.debate_engine.prompts.quality_constraints import (
    QUALITY_REQUIREMENTS_BLOCK,
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

    style_instruction = {
        "analytical": "Reason analytically based on the evidence presented.",
        "creative": "Reflect creatively and consider unexpected insights.",
        "devil_advocate": "Acknowledge what challenged your position most.",
        "balanced": "Reflect in a balanced, nuanced way.",
    }.get(reasoning_style, "Reflect in a balanced, nuanced way.")

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

    return f"""You are a debate participant with the role: {role}.
{persona_block(role)}
The debate question is: {question}

Your original opening stance was:
{_compact_text(original_stance, 260)}

Debate digest (Round 1 positions and Round 2 critiques):
{_compact_text(debate_digest, 1300)}
{knowledge_block}{context_block}
Your task: Generate your final synthesis for Round 3.

Reasoning style: {style_instruction}
{depth_instruction}

{QUALITY_REQUIREMENTS_BLOCK}

Round 3 objective (genuine synthesis, not averaging):
- Treat this as an expert-committee conclusion, not a compromise summary.
- Identify the strongest VALID arguments and reject the weakest reasoning
  explicitly (in `losing_argument`).
- Do not average opinions: pick a dominant position even when uncertainty
  remains, and state the uncertainty in `risk_tradeoffs` / `unresolved_questions`.
- Explain WHY the conclusion changed after Round 2 critique (in `what_changed`
  and `position_shift`). "Did not change" is a valid answer if you justify it.

Output contract:
- Return only valid JSON.
- Do not use markdown fences.
- Do not mention JSON, schema, fields, or instructions.
- Do NOT describe your process.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- Every field must be user-facing content.
- one_sentence_takeaway must be ONE complete sentence (15-25 words). Never truncate.
- short_summary must mirror one_sentence_takeaway (kept for backward compatibility).
- response must be clean prose for end users.
- Write like a final conclusion for a human reader.
- Take a strong final stance, not a process note.
- Synthesize across the agents' strongest arguments and critiques.
- End with a clear conclusion.
- Synthesis must explain what changed after critique and why.

Decision rule (mandatory):
- You MUST resolve the debate by choosing a dominant position OR explicitly state
  that no resolution is possible (and why). NO neutral, generic, hedging text.
- You MUST identify a single key trade-off, the winning argument, the losing
  argument, and your overall confidence (low | medium | high).

Forbidden examples:
- "I need to create a JSON object..."
- "Generating JSON synthesis..."
- "Here is the JSON..."

Return only valid JSON in this exact format:
{{
    "one_sentence_takeaway": "<ONE complete sentence, 15-25 words, capturing the final position>",
    "short_summary": "<same sentence as one_sentence_takeaway>",
    "final_position": "<clear final stance, OR an explicit 'no resolution because ...' statement>",
    "core_consensus": "<the single most important point all agents converged on, or '' if none>",
    "major_disagreements": ["<disagreement 1>", "<disagreement 2>"],
    "risk_tradeoffs": ["<risk or trade-off 1>", "<risk or trade-off 2>"],
    "policy_direction": "<the recommended direction in one sentence>",
    "unresolved_questions": ["<open question 1>", "<open question 2>"],
    "key_tradeoff": "<the single key trade-off that decided this position>",
    "winning_argument": "<the argument that prevailed and why>",
    "losing_argument": "<the strongest argument that did NOT prevail and why>",
    "confidence": "low | medium | high",
    "confidence_level": "low | medium | high",
    "what_changed": "<what changed or was refined after Round 2>",
    "position_shift": "<how the synthesis position shifted vs Round 1, in one sentence>",
    "strongest_argument": "<strongest argument from the full debate>",
    "remaining_concerns": "<important unresolved concerns>",
    "conclusion": "<final concise conclusion>",
    "response": "<full readable synthesis>",
    "key_evidence_used": ["<E-label or short title of evidence that drove the conclusion>"],
    "rejected_evidence": ["<E-label of evidence you discounted, with one-line reason>"],
    "evidence_conflicts": ["<short description of where evidence disagreed and how you resolved it>"],
    "evidence_gaps": ["<factual question the evidence did not answer>"]
}}"""
