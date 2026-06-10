"""Step 37 — Synthesis Verdict prompts.

Build the prompt for the neutral aggregation step that produces a single
user-facing verdict over the three agent final / updated syntheses.

The verdict generator is *not* a fourth debater. It must:
  - Use only arguments already present in the debate.
  - Aggregate, summarize, and reconcile — never invent new facts.
  - Represent disagreement honestly when it exists (draw / mixed).
  - Directly answer the original question (and the follow-up, if any).
"""

from __future__ import annotations
from app.services.language_detection import language_requirement_block

import json
from typing import Any

from app.services.debate_engine.prompts.quality_constraints import (
    ASSUMPTION_LABELING_BLOCK,
    FACTUALITY_BLOCK,
    FIELD_DIFFERENTIATION_BLOCK,
    STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK,
    evidence_mode_block,
)


def _compact_text(value: str | None, max_chars: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 1].rstrip() + "…"


def _format_agent_block(
    agent_syntheses: list[dict[str, Any]],
    *,
    per_field_chars: int = 700,
) -> str:
    """Render the three agent syntheses into a labeled, compact block."""
    if not agent_syntheses:
        return "(No agent syntheses were available.)"

    lines: list[str] = []
    for idx, item in enumerate(agent_syntheses, start=1):
        role = str(item.get("role") or item.get("agent_role") or "agent").strip()
        payload: dict[str, Any] = item.get("structured") or item.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}

        takeaway = payload.get("one_sentence_takeaway") or payload.get("short_summary") or ""
        position = (
            payload.get("updated_conclusion")
            or payload.get("final_position")
            or payload.get("conclusion")
            or payload.get("response")
            or ""
        )
        what_changed = payload.get("what_changed") or payload.get("change_reason") or ""
        winning = payload.get("winning_argument") or payload.get("strongest_argument") or ""
        losing = payload.get("losing_argument") or ""
        tradeoff = payload.get("key_tradeoff") or ""
        confidence = payload.get("confidence") or ""
        consensus = payload.get("core_consensus") or ""
        body = payload.get("response") or position

        lines.append(f"--- Agent {idx} · role={role} ---")
        if takeaway:
            lines.append(f"  takeaway: {_compact_text(takeaway, 220)}")
        if position:
            lines.append(f"  position: {_compact_text(position, per_field_chars)}")
        if winning:
            lines.append(f"  winning_argument: {_compact_text(winning, 320)}")
        if losing:
            lines.append(f"  losing_argument: {_compact_text(losing, 320)}")
        if tradeoff:
            lines.append(f"  key_tradeoff: {_compact_text(tradeoff, 260)}")
        if what_changed:
            lines.append(f"  what_changed: {_compact_text(what_changed, 260)}")
        if consensus:
            lines.append(f"  consensus_note: {_compact_text(consensus, 260)}")
        if confidence:
            lines.append(f"  confidence: {confidence}")
        if body and body != position:
            lines.append(f"  full_response: {_compact_text(body, per_field_chars)}")
        lines.append("")

    return "\n".join(lines).strip()


def _format_debate_summary(debate_summary: dict[str, Any] | None) -> str:
    if not debate_summary:
        return ""
    try:
        compact = json.dumps(debate_summary, ensure_ascii=False)
    except Exception:
        return ""
    return _compact_text(compact, 900)


def build_synthesis_verdict_prompt(
    original_question: str,
    cycle_number: int,
    round_type: str,
    agent_syntheses: list[dict[str, Any]],
    debate_summary: dict[str, Any] | None = None,
    followup_question: str | None = None,
    has_evidence: bool = False,
    response_language_code: str = "",
    response_language_name: str = "",
) -> str:
    """Build the moderator-aggregator prompt for the synthesis verdict.

    Parameters mirror the spec in STEP 37 plan: original question, cycle
    number (1 for initial Round 3, ≥2 for follow-up updated synthesis),
    round_type ("final" or "updated_synthesis"), agent syntheses (list of
    dicts with at least ``role`` and ``structured`` payload), optional
    debate summary and follow-up question, and an evidence-mode flag.
    """
    is_followup = bool(followup_question) or (cycle_number > 1) or round_type == "updated_synthesis"
    cycle_label = "initial Round 3" if cycle_number <= 1 else f"follow-up cycle #{cycle_number - 1}"

    agents_block = _format_agent_block(agent_syntheses)
    debate_summary_block = _format_debate_summary(debate_summary)
    debate_summary_section = (
        f"\nDebate summary so far (compressed memory across cycles):\n{debate_summary_block}\n"
        if debate_summary_block
        else ""
    )
    followup_block = (
        f"\nFollow-up question (cycle {cycle_number}):\n{_compact_text(followup_question, 400)}\n"
        if is_followup and followup_question
        else ""
    )

    response_requirement = (
        "  - response: a polished 3-5 paragraph user-facing synthesis. It MUST "
        "directly answer the original question. For follow-up cycles it MUST "
        "ALSO answer the new follow-up question and explicitly state what "
        "changed since the previous cycle.\n"
        if is_followup
        else "  - response: a polished 3-5 paragraph user-facing synthesis. It MUST "
        "directly answer the original question.\n"
    )

    what_changed_rule = (
        "  - what_changed MUST describe what shifted since the previous cycle's "
        "verdict (consensus, disagreement, or recommendation). If nothing "
        "substantive shifted, say so explicitly — do not pad.\n"
        if is_followup
        else "  - what_changed MUST be an empty string for cycle 1 (this is the "
        "initial verdict; there is nothing to compare against).\n"
    )

    return f"""You are a neutral synthesis moderator at the end of {cycle_label}.

You are NOT a fourth debater. You do not introduce a new independent argument
unless it is strictly necessary to reconcile the existing debate. Your job is
to compare the three agent syntheses below and produce ONE clear user-facing
conclusion that fairly represents the debate state.

Original question:
{_compact_text(original_question, 600)}
{language_requirement_block(response_language_code, response_language_name)}
{followup_block}{debate_summary_section}
Agent syntheses (the only material you may aggregate from):
{agents_block}

Aggregation rules (mandatory):
- Use only arguments already present in the agent syntheses (and the optional
  debate summary). Do not invent new claims, statistics, citations, named
  experts, regulations, or examples.
- If agents disagree, represent the disagreement fairly. Do not flatten it
  into a fake consensus.
- If no side clearly wins, set winning_side to "draw" or "mixed".
- Use "mixed" when different parts of different agents' arguments should be
  combined into the recommended answer.
- Do not overstate consensus, do not soften real disagreement, do not paste
  one agent's synthesis verbatim.
- Confidence reflects how much the three syntheses converge: convergent →
  high; partially overlapping → medium; mostly contradictory → low.

Disagreement detection (mandatory):
- Set consensus_level to exactly one of: High Consensus, Moderate Consensus,
  Low Consensus, Fundamental Disagreement. Judge it across four axes: policy
  agreement, mechanism agreement, evidence agreement, and risk-assessment
  agreement. Do NOT default to "All agents agree" — most expert panels reach
  only partial agreement.
- Set initial_divergence to exactly one of: Low Divergence, Moderate
  Divergence, High Divergence. Judge how far apart the agents STARTED, based on
  their position, assumption, and priority differences (use the debate
  summary / Round 1 material).
- strongest_surviving_argument: the single argument that survived all critiques.
- weakest_defended_assumption: the assumption that took the most successful
  attacks and was least defended.
- core_tradeoff: the difficult trade-off that remains genuinely unresolved.
- decision_confidence (High | Medium | Low): based on argument quality,
  evidence quality, and degree of disagreement.

Convergence quality (mandatory):
- Set convergence_quality to exactly one of: "earned" or "shallow".
  Use "earned" when consensus emerged because arguments survived criticism.
  Use "shallow" when agents simply started from similar positions and never
  genuinely disagreed.
- If there is no consensus, set convergence_quality to "none".

Anti-convergence rule (mandatory):
- If the agents reached essentially the same conclusion, do NOT just report
  agreement. In convergence_note, explicitly state: what disagreement
  disappeared, why it disappeared, and which argument caused the convergence.
- If genuine disagreement remains, set convergence_note to an empty string.

{evidence_mode_block(has_evidence)}

{FACTUALITY_BLOCK}

{FIELD_DIFFERENTIATION_BLOCK}

{ASSUMPTION_LABELING_BLOCK}

Create one unified final answer. Do not simply list agent opinions. Resolve the
debate into a clear recommendation. Mention consensus, remaining disagreement,
trade-offs, and confidence.

{STRUCTURED_OUTPUT_CONSTRAINTS_BLOCK}
Output contract — return ONLY this JSON, no markdown fences, no commentary:
{{
  "one_sentence_takeaway": "One concise sentence, max 24 words.",
  "consensus_level": "High Consensus | Moderate Consensus | Low Consensus | Fundamental Disagreement",
  "initial_divergence": "Low Divergence | Moderate Divergence | High Divergence",
  "convergence_quality": "earned | shallow | none",
  "consensus_statement": "What the agents mostly agree on.",
  "main_disagreement": "The strongest remaining disagreement.",
  "strongest_surviving_argument": "The argument that survived all critiques.",
  "weakest_defended_assumption": "The assumption that took the most successful attacks.",
  "core_tradeoff": "The difficult trade-off that remains unresolved.",
  "convergence_note": "If agents converged: what disagreement disappeared, why, and which argument caused it. Otherwise empty string.",
  "recommended_answer": "The final answer the user should take away.",
  "winning_side": "analyst | critic | creative | draw | mixed",
  "confidence": "low | medium | high",
  "decision_confidence": "High | Medium | Low",
  "what_changed": "What changed in this cycle compared with the previous cycle, or empty string for cycle 1.",
  "reasoning_basis": [
    "Key reason 1 from the debate.",
    "Key reason 2 from the debate.",
    "Key reason 3 from the debate."
  ],
  "unresolved_questions": [
    "Remaining question 1",
    "Remaining question 2"
  ],
  "tradeoffs": [
    "Trade-off 1",
    "Trade-off 2"
  ],
  "response": "A polished user-facing synthesis in 3-5 paragraphs."
}}

Strict field rules:
  - winning_side MUST be exactly one of: analyst | critic | creative | draw | mixed.
  - confidence MUST be exactly one of: low | medium | high.
  - consensus_level MUST be exactly one of: High Consensus | Moderate Consensus | Low Consensus | Fundamental Disagreement.
  - initial_divergence MUST be exactly one of: Low Divergence | Moderate Divergence | High Divergence.
  - convergence_quality MUST be exactly one of: earned | shallow | none.
  - decision_confidence MUST be exactly one of: High | Medium | Low.
  - convergence_note MUST be a non-empty explanation when agents converged, otherwise an empty string.
  - reasoning_basis MUST be an array of 2-5 short reasons drawn from the
    agent syntheses (paraphrase, do not copy verbatim).
  - unresolved_questions MAY be an empty array if the verdict is strong.
{response_requirement}{what_changed_rule}  - response MUST NOT simply concatenate the other JSON fields.
  - response MUST NOT be a verbatim copy of any single agent's synthesis.
  - All natural-language values MUST follow the active response-language requirement.

Forbidden meta phrases inside any field: "I will", "Generating", "Here is",
"As an AI", "JSON", "schema". Every field must be user-facing prose.
""".strip()


__all__ = ["build_synthesis_verdict_prompt"]
