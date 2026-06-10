"""Round 3 — Critique Response prompts.

Each agent receives the critiques directed at them from Round 2 and must
produce an explicit, traceable response: which points they accept, which they
reject, and what they will change in their revised position.
"""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.debate_engine.prompts.reasoning_styles import style_instruction as _style_instruction
from app.services.debate_engine.prompts.quality_constraints import STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK


def _compact_text(value: str, max_chars: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "…"


def _format_critiques_block(critiques_received: list[dict]) -> str:
    """Render critiques addressed to this agent."""
    if not critiques_received:
        return "(No critiques were received.)"
    lines: list[str] = []
    for i, c in enumerate(critiques_received, start=1):
        from_role = c.get("from_role", f"Critic {i}")
        target_claim = c.get("target_claim") or c.get("challenge") or ""
        critique_text = c.get("critique_summary") or c.get("short_summary") or c.get("response", "")
        weakness = c.get("weakness_found") or ""
        suggestion = c.get("counterargument") or ""
        lines.append(f"\nCritique {i} — from {from_role}:")
        if target_claim:
            lines.append(f"  Target claim: {_compact_text(target_claim, 200)}")
        if critique_text:
            lines.append(f"  Critique: {_compact_text(critique_text, 400)}")
        if weakness:
            lines.append(f"  Weakness identified: {_compact_text(weakness, 200)}")
        if suggestion:
            lines.append(f"  Suggested improvement: {_compact_text(suggestion, 200)}")
    return "\n".join(lines)


def build_critique_response_prompt(
    role: str,
    question: str,
    own_initial_position: str,
    critiques_received: list[dict],  # list of {from_role, target_claim, critique_summary, weakness_found, counterargument}
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
) -> str:
    """Build the Round 3 prompt for an agent responding to critiques received.

    Args:
        role: This agent's role label.
        question: The central debate question.
        own_initial_position: This agent's Round 1 position summary.
        critiques_received: List of critique dicts from other agents targeting this agent.
        reasoning_style: How this agent reasons.
        reasoning_depth: Depth of engagement.
    """
    depth_instruction = {
        "shallow": "Be concise. 2-3 sentences per accepted/rejected point.",
        "normal": "Be substantive. A short paragraph per accepted/rejected point.",
        "deep": "Be rigorous. Detailed analysis of each accepted/rejected point with evidence.",
    }.get(reasoning_depth, "Be substantive.")

    style_hint = _style_instruction("respond", reasoning_style)
    critiques_block = _format_critiques_block(critiques_received)
    n_critiques = len(critiques_received) if critiques_received else 0

    return f"""You are an expert panelist defending your position after receiving critiques.
Respond honestly and specifically — never narrate instructions, your role, output formatting, schemas, or your own process.

role: {role}.
{persona_block(role)}
Question: {question}

Your initial position: {_compact_text(own_initial_position, 400)}

Critiques received ({n_critiques} critique(s)):
{critiques_block}

Your task: For each critique received, state whether you accept or reject the specific criticism, and explain why. 
- Do NOT dismiss critiques without reason.
- Do NOT agree with everything to appear balanced.
- Identify CONCRETE points you will change vs. points you maintain.
- If you accept a critique, explain HOW it changes your thinking.
- If you reject a critique, provide a specific counter-reason, not a generic dismissal.
- Be honest about genuine weaknesses in your position.
{depth_instruction} {style_hint}.

Respond to the critique you received. Accept valid criticism where appropriate.
Reject or clarify inaccurate criticism. Prepare how your position should change.
{STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK}
Return only valid JSON. No markdown fences. Do not mention JSON, schema, fields, or instructions.
{{
    "responding_to_agent": "<role of the agent who critiqued you, or General criticism>",
    "challenge_received": "<the main challenge you received>",
    "received_critique_summary": "<1-2 sentence summary of the main critiques you received>",
    "accepted_points": ["<specific point from a critique you accept and why>", "..."],
    "rejected_points": ["<specific point from a critique you reject and the exact counter-reason>", "..."],
    "defense": "<your defense against inaccurate or incomplete criticism>",
    "clarification": "<what needed clarification>",
    "planned_revision": "<what you will specifically change in your revised position, or 'No change — my initial position holds because...' with a concrete reason>",
    "stance_update": "unchanged | slightly_revised | significantly_revised | reversed",
    "response": "<full prose response to all critiques, 200-400 words>"
}}"""
