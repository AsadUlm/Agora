"""Round 4 — Revised Position prompts.

Each agent produces a final revised position after:
  - its initial position (Round 1)
  - critiques received (Round 2)
  - its response to those critiques (Round 3)

This produces explicit before/after evidence for every agent, which is
required for the debate traceability requirement.
"""

from __future__ import annotations

from app.services.debate_engine.prompts.personas import persona_block
from app.services.language_detection import language_requirement_block
from app.services.debate_engine.prompts.reasoning_styles import style_instruction as _style_instruction
from app.services.debate_engine.prompts.quality_constraints import STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK


def _compact_text(value: str, max_chars: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "…"


def _format_critique_exchange_block(
    critiques: list[dict],
    critique_response: dict | None,
) -> str:
    """Render the critique + response exchange for context."""
    lines: list[str] = []
    if critiques:
        lines.append("Critiques you received:")
        for i, c in enumerate(critiques, start=1):
            from_role = c.get("from_role", f"Critic {i}")
            summary = c.get("critique_summary") or c.get("short_summary") or c.get("response", "")
            lines.append(f"  • From {from_role}: {_compact_text(summary, 250)}")
    if critique_response:
        accepted = critique_response.get("accepted_points") or []
        rejected = critique_response.get("rejected_points") or []
        planned = critique_response.get("planned_revision", "")
        lines.append("\nYour response to those critiques:")
        for pt in accepted[:3]:
            lines.append(f"  ✓ Accepted: {_compact_text(str(pt), 180)}")
        for pt in rejected[:3]:
            lines.append(f"  ✗ Rejected: {_compact_text(str(pt), 180)}")
        if planned:
            lines.append(f"  Planned revision: {_compact_text(planned, 220)}")
    return "\n".join(lines) if lines else "(No critique exchange available.)"


def build_revised_position_prompt(
    role: str,
    question: str,
    initial_position: str,
    initial_key_claims: list[str],
    critiques_received: list[dict],
    critique_response: dict | None,
    other_agents_revised_summaries: list[dict] | None = None,
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    response_language_code: str = "",
    response_language_name: str = "",
) -> str:
    """Build the Round 4 prompt for an agent's revised final position.

    Args:
        role: This agent's role label.
        question: The central debate question.
        initial_position: This agent's Round 1 position summary.
        initial_key_claims: Key claims from Round 1.
        critiques_received: Critiques this agent received in Round 2.
        critique_response: This agent's Round 3 response to critiques.
        other_agents_revised_summaries: Optional summaries of other agents' revised positions.
        reasoning_style: How this agent reasons.
        reasoning_depth: Depth of revision analysis.
    """
    depth_instruction = {
        "shallow": "Be concise. A few sentences per section.",
        "normal": "Be substantive. A short paragraph per section.",
        "deep": "Be thorough. Detailed analysis per section with explicit reasoning.",
    }.get(reasoning_depth, "Be substantive.")

    style_hint = _style_instruction("revise", reasoning_style)
    exchange_block = _format_critique_exchange_block(critiques_received, critique_response)

    claims_block = ""
    if initial_key_claims:
        claims_block = "\nInitial key claims:\n" + "\n".join(
            f"  • {_compact_text(c, 180)}" for c in initial_key_claims[:5]
        )

    others_block = ""
    if other_agents_revised_summaries:
        lines = ["\nOther agents' emerging positions (for context):"]
        for a in other_agents_revised_summaries[:3]:
            r = a.get("role", "Agent")
            s = a.get("summary", "")
            if s:
                lines.append(f"  • {r}: {_compact_text(s, 200)}")
        others_block = "\n".join(lines)

    return f"""You are an expert panelist producing your final revised position after a structured debate.
Synthesize your initial position, the critiques you received, and your response to those critiques into one clear, updated stance.
Never narrate instructions, your role, output formatting, schemas, or your own process.

role: {role}.
{persona_block(role)}
Question: {question}
{language_requirement_block(response_language_code, response_language_name)}

Your initial position: {_compact_text(initial_position, 400)}{claims_block}

{exchange_block}{others_block}

Your task: Produce your REVISED POSITION.
Rules:
- If your position has changed: say EXACTLY what changed, what caused it, and how your new position differs.
- If your position has NOT changed: explicitly say so AND explain why the critiques did not change it (with a concrete reason).
- Do NOT produce a vague compromise. Take a clear stance.
- Reference the specific critiques or arguments that influenced (or failed to influence) you.
- Be honest about remaining uncertainties.
- Do not ignore the critique.
{depth_instruction} {style_hint}.

Valid change_type values: no_change | narrowed_position | expanded_position | changed_stance | added_condition | resolved_uncertainty | other

{STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK}
Return only valid JSON. No markdown fences. Do not mention JSON, schema, fields, or instructions.
{{
    "initial_position": "<1-2 sentence summary of your Round 1 position>",
    "initial_position_summary": "<1-2 sentence summary of your Round 1 position>",
    "critique_received_from": "<role of the agent who critiqued you, or General criticism>",
    "received_critiques_summary": ["<1-sentence summary of each critique received>"],
    "revised_position": "<your updated position, 200-400 words>",
    "what_changed": "<what changed, or why the position was strengthened>",
    "change_label": "Changed | Partially changed | Strengthened | Unchanged",
    "change_summary": "<what changed (or exactly why nothing changed), 1-3 sentences>",
    "changed": true,
    "change_type": "no_change | narrowed_position | expanded_position | changed_stance | added_condition | resolved_uncertainty | other",
    "reason_for_change": "<specific argument or critique that caused the change, or why nothing changed>",
    "confidence": "high | medium | low",
    "key_claims": ["<core claim 1>", "<core claim 2>", "<core claim 3>"],
    "remaining_uncertainties": "<any remaining unresolved concerns>",
    "response": "<full revised position in readable prose>"
}}"""
