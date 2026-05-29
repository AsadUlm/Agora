"""Round 2 — Cross Examination prompts."""

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


def _compact_points(points: list[str], max_items: int = 2) -> list[str]:
    return [_compact_text(point, 110) for point in points[:max_items] if str(point or "").strip()]


def _format_context_block(chunks: list[dict]) -> str:
    if not chunks:
        return ""
    lines = ["\nRelevant document context (reference when critiquing):\n"]
    for i, c in enumerate(chunks[:3], start=1):
        lines.append(f"[Source {i}]\n{_compact_text(c.get('content', ''), 260)}\n")
    return "\n".join(lines)


def _knowledge_instruction(
    knowledge_mode: str,
    knowledge_strict: bool,
    has_chunks: bool,
) -> str:
    if knowledge_mode == "no_docs":
        return "\nYou do not have access to any documents. Rely on reasoning to critique.\n"
    if not has_chunks:
        return ""
    instruction = "\nUse the following documents as your primary source of truth when challenging opponents. If unsure, explicitly say so.\n"
    if knowledge_strict:
        instruction += "IMPORTANT: Only base your critiques on the provided documents. Do not rely on general knowledge.\n"
    return instruction


def build_critique_prompt(
    role: str,
    question: str,
    own_stance: str,
    other_agents: list[dict],  # [{"role": str, "stance": str, "key_points": list[str]}]
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
    evidence_packets: list[EvidencePacket] | None = None,
) -> str:
    """
    Build the Round 2 prompt for an agent critiquing all other agents.

    Args:
        role:         This agent's role label.
        question:     The central debate question.
        own_stance:   This agent's Round 1 stance (for context).
        other_agents: List of other agents' Round 1 outputs to critique.
        reasoning_style: How this agent reasons.
        reasoning_depth: How deeply to critique.
    """
    depth_instruction = {
        "shallow": "Be concise. One focused challenge per opponent.",
        "normal": "Be substantive. Identify the core weakness per opponent (2-3 sentences each).",
        "deep": "Be rigorous. Dissect each argument thoroughly, cite logical fallacies or missing evidence.",
    }.get(reasoning_depth, "Be substantive.")

    style_instruction = _style_instruction("critique", reasoning_style)

    # Format other agents' stances
    opponents_block = ""
    for i, agent in enumerate(other_agents, start=1):
        key_pts = "\n".join(f"    - {pt}" for pt in _compact_points(agent.get("key_points", [])))
        opponents_block += (
            f"\nOpponent {i} — {agent['role']}:\n"
            f"  Stance: {_compact_text(agent.get('stance', '(no stance provided)'), 220)}\n"
            f"  Key points:\n{key_pts or '    (none provided)'}\n"
        )

    return f"""You are an expert panelist in a live cross-examination, speaking to a human audience.
Challenge the other panelists' actual arguments — never narrate instructions, your role, output formatting, schemas, or your own process.

role: {role}.
{persona_block(role)}
Question: {question}

Your opening stance: {_compact_text(own_stance, 220)}
{_knowledge_instruction(knowledge_mode, knowledge_strict, bool(evidence_packets or retrieved_chunks or []))}{(format_evidence_block(evidence_packets or []) + format_evidence_usage_instructions()) if evidence_packets else _format_context_block(retrieved_chunks or [])}
{evidence_mode_block(bool(evidence_packets or retrieved_chunks or []))}
{opponents_block}
Deliver a sharp, structured critique built from four explicit parts: (1) OPPONENT CLAIM — name the agent and quote or closely paraphrase the specific claim you are attacking; (2) HIDDEN ASSUMPTION — identify the assumption that claim silently depends on; (3) FAILURE SCENARIO — describe a realistic case where that assumption is false and the claim breaks; (4) CONSEQUENCE — explain why this matters and what it does to the opponent's overall position. Then state WHY YOUR FRAMEWORK DISAGREES — begin it explicitly from your role ("As a {role}, I reject this because…") so your identity stays stable and you do not drift toward the opponent. Critique the weakest real argument, whoever made it — do not soften it into agreement. {depth_instruction} {style_instruction}. Back every critique with a concrete mechanism. Do not fabricate statistics — use qualitative phrasing.
If target content is unavailable, write: "The target response was unavailable, so this critique focuses on the general position."

Return only valid JSON. No markdown fences. Do not mention JSON, schema, fields, or instructions in your answer. Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
{{
    "one_sentence_takeaway": "<core flaw in 15-25 words>",
    "short_summary": "<2 sentences adding a supporting reason the takeaway omits>",
    "target_agent": "<role being challenged>",
    "challenge": "<specific claim being challenged, quoting or paraphrasing the target>",
    "assumption_attacked": "<the hidden assumption that claim depends on>",
    "failure_scenario": "<a realistic case where that assumption is false>",
    "why_it_breaks": "<why that assumption fails under real conditions>",
    "why_my_framework_disagrees": "<begin with 'As a {role}, I reject this because…' and ground it in your priorities>",
    "real_world_implication": "<what changes in practice if your critique holds>",
    "weakness_found": "<the core weakness>",
    "counterargument": "<your counterargument>",
    "response": "<full adversarial critique in prose, 300-500 words>"
}}"""
