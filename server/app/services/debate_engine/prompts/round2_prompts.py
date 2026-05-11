"""Round 2 — Cross Examination prompts."""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block


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

    style_instruction = {
        "analytical": "Critique analytically — focus on logical consistency and evidence gaps.",
        "creative": "Challenge creatively — expose hidden assumptions and alternative framings.",
        "devil_advocate": "Challenge aggressively — find the sharpest weakness in each argument.",
        "balanced": "Critique fairly — acknowledge strengths before identifying weaknesses.",
    }.get(reasoning_style, "Critique fairly.")

    # Format other agents' stances
    opponents_block = ""
    for i, agent in enumerate(other_agents, start=1):
        key_pts = "\n".join(f"    - {pt}" for pt in _compact_points(agent.get("key_points", [])))
        opponents_block += (
            f"\nOpponent {i} — {agent['role']}:\n"
            f"  Stance: {_compact_text(agent.get('stance', '(no stance provided)'), 220)}\n"
            f"  Key points:\n{key_pts or '    (none provided)'}\n"
        )

    return f"""You are a debate participant with the role: {role}.
{persona_block(role)}
The debate question is: {question}

Your own opening stance was: {_compact_text(own_stance, 220)}
{_knowledge_instruction(knowledge_mode, knowledge_strict, bool(retrieved_chunks or []))}{_format_context_block(retrieved_chunks or [])}
Your task: Critique the following opponents' arguments in Round 2 Cross-Examination.

{opponents_block}

Critique style: {style_instruction}
{depth_instruction}

MANDATORY interaction rules:
- You MUST quote or paraphrase a specific phrase from the target's argument.
- You MUST explicitly name the agent / role you are challenging.
- You MUST NOT produce an isolated essay — every paragraph must reference a
  concrete claim from another agent.

For each opponent, you MUST identify a SPECIFIC logical weakness and explain why
it fails under real-world conditions. Avoid generic statements like "needs more
evidence" or "could be stronger". Concretely, your critique MUST include:
  - the specific assumption being attacked (assumption_attacked),
  - why that assumption breaks down (why_it_breaks),
  - the real-world implication if you are right (real_world_implication).

Output contract:
- Return only valid JSON.
- Do not use markdown fences.
- Do not mention JSON, schema, fields, or instructions.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- Every field must be user-facing content.
- one_sentence_takeaway must be ONE complete sentence (15-25 words). Never truncate.
- short_summary must mirror one_sentence_takeaway (kept for backward compatibility).
- response must be clean prose for end users.
- If target content is unavailable, use this sentence in challenge context:
    "The target response was unavailable, so this critique focuses on the general position."

Forbidden examples:
- "I need to create a JSON object..."
- "Generating JSON synthesis..."
- "Here is the JSON..."

Return only valid JSON in this exact format:
{{
    "one_sentence_takeaway": "<ONE complete sentence, 15-25 words, naming the core flaw>",
    "short_summary": "<same sentence as one_sentence_takeaway>",
    "target_agent": "<name or role of the agent being challenged>",
    "challenge": "<specific claim being challenged>",
    "assumption_attacked": "<the specific assumption you are attacking>",
    "why_it_breaks": "<why that assumption fails under real conditions>",
    "real_world_implication": "<what changes in practice if your critique holds>",
    "weakness_found": "<why that argument is weak or incomplete>",
    "counterargument": "<clean counterargument>",
    "response": "<full user-facing critique>"
}}"""
