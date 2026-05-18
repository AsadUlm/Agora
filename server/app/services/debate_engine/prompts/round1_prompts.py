"""Round 1 — Opening Statement prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.debate_engine.prompts.reasoning_styles import style_instruction as _style_instruction
from app.services.debate_engine.prompts.quality_constraints import (
    ANTI_STRAWMAN_BLOCK,  # noqa: F401  (re-exported via prompts package)
    ASSUMPTION_LABELING_BLOCK,
    FACTUALITY_BLOCK,
    FIELD_DIFFERENTIATION_BLOCK,
    QUALITY_REQUIREMENTS_BLOCK,
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
    depth_instruction = {
        "shallow": "Be concise. 2-3 key points only.",
        "normal": "Be thorough. Provide 3-5 well-argued key points.",
        "deep": "Be exhaustive. Provide 5+ key points with detailed reasoning.",
    }.get(reasoning_depth, "Be thorough. Provide 3-5 well-argued key points.")

    style_instruction = _style_instruction("reason", reasoning_style)

    chunks = retrieved_chunks or []
    packets = evidence_packets or []
    has_evidence = bool(packets) or bool(chunks)
    # Step 29: prefer the structured evidence block when packets are supplied;
    # fall back to the legacy raw-chunk block for backward compatibility.
    if packets:
        context_block = (
            format_evidence_block(packets) + format_evidence_usage_instructions()
        )
    else:
        context_block = _format_context_block(chunks)
    knowledge_block = _knowledge_instruction(
        knowledge_mode, knowledge_strict, has_evidence
    )

    return f"""You are a debate participant with the role: {role}.
{persona_block(role)}
The debate question is: {question}
{knowledge_block}{context_block}
Your task: Generate your opening statement for Round 1.

Reasoning style: {style_instruction}
{depth_instruction}

{evidence_mode_block(has_evidence)}

{QUALITY_REQUIREMENTS_BLOCK}

{FACTUALITY_BLOCK}

{FIELD_DIFFERENTIATION_BLOCK}

{ASSUMPTION_LABELING_BLOCK}

Round 1 objective (independent thesis):
- This is your OPENING THESIS. You are not yet reacting to other agents.
- State an explicit thesis (one sentence) before defending it.
- Identify the causal MECHANISM that supports the thesis (who acts, what
  they do, what changes).
- Surface at least one explicit RISK or trade-off your thesis must absorb.
- Avoid restating the question and avoid generic abstractions.

Length & substance bar (mandatory):
- The `response` field MUST be a full analytical answer, not a slogan.
  Target 350-650 words organized into 4-6 short paragraphs.
- The answer MUST cover, in this order:
    1. Main position (your thesis as a single direct claim).
    2. Key reasoning (the mechanism / evidence chain that supports it).
    3. Concrete domain anchor (a specific actor, scenario, or threshold
       the persona naturally cares about).
    4. Risks / uncertainties / trade-offs your position has to absorb.
    5. Final stance (what you would actually recommend or defend).
- DO NOT collapse the answer into a one-paragraph summary. The detail
  panel will render `response` verbatim, so produce the full reasoning.
- The persona's voice must be visible across multiple paragraphs (an
  Analyst sounds like structured policy analysis, a Critic sounds
  adversarial, a Creative reframes the problem, etc.).

Output contract:
- Return only valid JSON.
- Do not use markdown fences.
- Do not mention JSON, schema, fields, or instructions.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- Every field must be user-facing content.
- one_sentence_takeaway must be ONE complete sentence (15-25 words) that captures your core claim. Never truncate.
- short_summary must mirror one_sentence_takeaway (kept for backward compatibility).
- response must be the FULL analytical answer (not a summary).

Forbidden examples:
- "I need to create a JSON object..."
- "Generating JSON synthesis..."
- "Here is the JSON..."

Return only valid JSON in this exact format:
{{
    "one_sentence_takeaway": "<ONE complete sentence, 15-25 words, captures core claim>",
    "short_summary": "<same sentence as one_sentence_takeaway>",
    "stance": "Supports | Opposes | Mixed | Conditional",
    "main_argument": "<clean paragraph stating the thesis and its core mechanism>",
    "key_points": ["<point 1>", "<point 2>", "<point 3>", "<optional point 4>"],
    "risks_or_caveats": ["<risk or caveat>", "<optional second caveat>"],
    "response": "<FULL multi-paragraph analytical answer (350-650 words) covering: 1) Main position, 2) Key reasoning, 3) Domain anchor, 4) Risks / uncertainties, 5) Final stance. This is the body shown to the user \u2014 do NOT shorten it.>"
}}

Length-style example (note `response` is a multi-paragraph analytical answer):
{{
    "one_sentence_takeaway": "Targeted AI regulation is justified for high-risk systems because market incentives alone do not absorb their downstream harms.",
    "short_summary": "Targeted AI regulation is justified for high-risk systems because market incentives alone do not absorb their downstream harms.",
    "stance": "Conditional",
    "main_argument": "Risk-tiered regulation that targets safety-critical deployments outperforms either blanket licensing or pure self-governance.",
    "key_points": [
        "Healthcare AI and autonomous weapons concentrate risk where errors are catastrophic.",
        "Compute-threshold (e.g. > 10^25 FLOPs) gating concentrates oversight on frontier labs.",
        "Liability rules realign incentives faster than ex-ante audits in moving markets."
    ],
    "risks_or_caveats": [
        "Threshold-based rules can be gamed by sharding training runs.",
        "Open-source ecosystems can be disproportionately burdened by audit costs."
    ],
    "response": "My position is that AI regulation should be risk-tiered rather than blanket... [4-6 paragraphs covering position, mechanism, anchor, risks, and recommendation]"
}}"""
