"""Follow-up cycle prompts (cycle 2+).

Three new round types are introduced for ongoing debate continuation:

  - ``followup_response``    — each agent answers the new follow-up question,
                               staying consistent with their established stance.
  - ``followup_critique``    — agents challenge the weakest follow-up response,
                               or — when no peer is available — the strongest
                               argument or an unresolved issue from memory.
  - ``updated_synthesis``    — moderator-style synthesis explaining how the
                               debate evolved with the new question. Must
                               explicitly state whether the conclusion changed.

Step 24:
  - Inputs now include a structured ``debate_summary``
    (consensus / main_conflict / strongest_arguments / unresolved_questions)
    and ``cycle_memories`` (compact summaries of prior follow-up cycles)
    instead of the raw agent_states + history.
  - Response prompt requests an explicit ``position_evolution`` object.
  - Critique prompt declares fallback targets and forbids skipping.
  - Synthesis prompt requires explicit ``conclusion_changed`` and ``change_reason``.
"""

from __future__ import annotations

from typing import Any


# ── Shared helpers ────────────────────────────────────────────────────────────

def _compact(text: str, max_chars: int) -> str:
    norm = " ".join(str(text or "").split())
    if len(norm) <= max_chars:
        return norm
    return norm[: max_chars - 1].rstrip() + "…"


def _format_context_block(chunks: list[dict] | None) -> str:
    if not chunks:
        return ""
    lines = ["\nRelevant document context (use it to ground your follow-up):\n"]
    for i, c in enumerate(chunks[:3], start=1):
        lines.append(f"[Source {i}]\n{_compact(c.get('content', ''), 240)}\n")
    return "\n".join(lines)


def _knowledge_instruction(
    knowledge_mode: str, knowledge_strict: bool, has_chunks: bool
) -> str:
    if knowledge_mode == "no_docs":
        return "\nYou do not have access to documents. Rely on prior debate memory and reasoning.\n"
    if not has_chunks:
        return ""
    instr = "\nUse the provided documents as primary source of truth in your follow-up answer.\n"
    if knowledge_strict:
        instr += "IMPORTANT: Only answer using the provided documents. Do not rely on general knowledge.\n"
    return instr


def _format_debate_summary(debate_summary: dict[str, Any] | None) -> str:
    """Render the structured debate_summary block (compact)."""
    if not debate_summary:
        return ""
    consensus = _compact(debate_summary.get("consensus", "") or "", 280)
    conflict = _compact(debate_summary.get("main_conflict", "") or "", 280)
    strongest = debate_summary.get("strongest_arguments", []) or []
    unresolved = debate_summary.get("unresolved_questions", []) or []

    lines = ["\nDebate snapshot (high-level):"]
    if consensus:
        lines.append(f"- Consensus so far: {consensus}")
    if conflict:
        lines.append(f"- Main conflict: {conflict}")
    if strongest:
        s_lines = [
            f"  · {_compact(str(s.get('role', 'agent')), 40)}: "
            f"{_compact(str(s.get('argument', '')), 200)}"
            for s in strongest[:6]
            if s.get("argument")
        ]
        if s_lines:
            lines.append("- Strongest arguments per agent:")
            lines.extend(s_lines)
    if unresolved:
        u_lines = [f"  · {_compact(str(u), 180)}" for u in unresolved[:5]]
        lines.append("- Unresolved questions:")
        lines.extend(u_lines)
    return "\n".join(lines) + "\n"


def _format_cycle_memories(cycle_memories: list[dict[str, Any]] | None) -> str:
    if not cycle_memories:
        return ""
    lines = ["\nPrior follow-up cycles (compressed):"]
    for c in cycle_memories[-4:]:  # at most last 4 cycles
        lines.append(f"- {_compact(str(c.get('summary', '')), 360)}")
    return "\n".join(lines) + "\n"


_OUTPUT_CONTRACT = """
Output contract:
- Return only valid JSON (single object, no markdown fences).
- Do not mention JSON, schema, or instructions.
- Do not include meta phrases like "I need to", "I will", "Generating", "Here is", or "As an AI".
- one_sentence_takeaway must be ONE complete sentence (15-25 words). Never truncate.
- short_summary must mirror one_sentence_takeaway (kept for backward compatibility).
- response must be clean prose suitable for end users.
"""


# ── 1. Follow-up response prompt ──────────────────────────────────────────────

def build_followup_response_prompt(
    role: str,
    original_question: str,
    follow_up_question: str,
    previous_synthesis: str,
    own_previous_position: str,
    own_key_arguments: list[str],
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
    debate_summary: dict[str, Any] | None = None,
    cycle_memories: list[dict[str, Any]] | None = None,
) -> str:
    depth = {
        "shallow": "Be concise. A few sentences per field.",
        "normal": "Be thorough. A short paragraph per field.",
        "deep": "Be exhaustive. Detailed analysis per field.",
    }.get(reasoning_depth, "Be thorough. A short paragraph per field.")

    style = {
        "analytical": "Reason analytically based on evidence.",
        "creative": "Reflect creatively and consider unexpected insights.",
        "devil_advocate": "Stay contrarian; challenge convenient assumptions.",
        "balanced": "Reflect in a balanced, nuanced way.",
    }.get(reasoning_style, "Reflect in a balanced, nuanced way.")

    points = "; ".join([_compact(p, 100) for p in (own_key_arguments or [])][:3]) or "(none recorded)"
    chunks = retrieved_chunks or []
    ctx = _format_context_block(chunks)
    knw = _knowledge_instruction(knowledge_mode, knowledge_strict, bool(chunks))
    summary_block = _format_debate_summary(debate_summary)
    cycles_block = _format_cycle_memories(cycle_memories)

    return f"""You are a debate participant with the role: {role}. The debate is ongoing.

Original debate question: {_compact(original_question, 280)}

Previous synthesis of the debate so far:
{_compact(previous_synthesis, 600)}
{summary_block}{cycles_block}
Your established position from the debate:
{_compact(own_previous_position, 280)}

Your previously expressed key arguments: {points}

The user has just asked a follow-up question:
"{_compact(follow_up_question, 600)}"
{knw}{ctx}
Your task — answer the follow-up while staying coherent with your role and prior position.
You may refine, strengthen, or change your stance, but you MUST report it explicitly
in `position_evolution`.

CRITICAL: You MUST challenge the previous conclusion, not repeat it. Either expose
a real new tension the follow-up uncovered, or explicitly explain WHY the original
position survives the new question. Do not paraphrase the previous synthesis.

Reasoning style: {style}
{depth}
{_OUTPUT_CONTRACT}
Required JSON fields:
- one_sentence_takeaway: ONE complete sentence (15-25 words) capturing your answer.
- short_summary: same sentence as one_sentence_takeaway.
- answer_to_followup: direct answer to the new question (1–3 sentences).
- key_points: 2–4 strings.
- confidence: one of "low", "medium", "high".
- position_evolution: object with the following string fields:
    - change: one of "no_change", "refined", "changed".
    - reason: 1 sentence on WHY (or why not).
- position_update: one short note (kept for backward compatibility — usually equals
  position_evolution.reason; set "" if change is "no_change").
- response: full prose answer for end users.
"""


# ── 2. Follow-up critique prompt ──────────────────────────────────────────────

def build_followup_critique_prompt(
    role: str,
    original_question: str,
    follow_up_question: str,
    previous_synthesis: str,
    own_followup: str,
    other_followups: list[dict[str, Any]],
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
    debate_summary: dict[str, Any] | None = None,
    cycle_memories: list[dict[str, Any]] | None = None,
) -> str:
    """Critique prompt — never skips.

    If there are no usable peer follow-ups, the agent must still produce a
    critique by targeting the strongest argument from memory or an unresolved
    question. The prompt explicitly forbids "no critique" output.
    """
    depth = {
        "shallow": "Be concise.",
        "normal": "Be thorough.",
        "deep": "Be exhaustive.",
    }.get(reasoning_depth, "Be thorough.")

    style = {
        "analytical": "Critique analytically.",
        "creative": "Critique creatively, exposing blind spots.",
        "devil_advocate": "Critique aggressively.",
        "balanced": "Critique in a balanced, fair way.",
    }.get(reasoning_style, "Critique in a balanced, fair way.")

    others_block = "\n".join(
        [
            f"- {_compact(o.get('role', 'agent'), 40)}: {_compact(o.get('answer', ''), 160)}"
            for o in (other_followups or [])
            if o.get("answer")
        ][:5]
    ) or "(no peer follow-ups available)"

    chunks = retrieved_chunks or []
    ctx = _format_context_block(chunks)
    knw = _knowledge_instruction(knowledge_mode, knowledge_strict, bool(chunks))
    summary_block = _format_debate_summary(debate_summary)
    cycles_block = _format_cycle_memories(cycle_memories)

    return f"""You are a debate participant with the role: {role}. The debate is ongoing.

Original debate question: {_compact(original_question, 240)}

Previous synthesis (context):
{_compact(previous_synthesis, 500)}
{summary_block}{cycles_block}
The user just asked: "{_compact(follow_up_question, 400)}"

Your own follow-up answer:
{_compact(own_followup, 360)}

Peer agents' follow-up answers:
{others_block}
{knw}{ctx}
Your task — produce a SUBSTANTIVE critique. You MUST identify a SPECIFIC logical
weakness and explain why it fails under real-world conditions. Avoid generic
statements like "needs more evidence" or "could be stronger".

Selection rules (apply in order):
  1. If there is a clear weakest peer follow-up, critique it.
  2. Otherwise, critique the STRONGEST argument from the debate snapshot — explain
     where it is most vulnerable.
  3. Otherwise, critique an UNRESOLVED question from the snapshot — explain why
     the current debate has not resolved it.
NEVER skip the critique. NEVER return only "no peer available" — you must always
produce a useful challenge using rule 2 or 3 when no peer answer is usable.

Concretely, your critique MUST include:
  - the specific assumption being attacked (assumption_attacked),
  - why that assumption breaks down (why_it_breaks),
  - the real-world implication if you are right (real_world_implication).

Reasoning style: {style}
{depth}
{_OUTPUT_CONTRACT}
Required JSON fields:
- one_sentence_takeaway: ONE complete sentence (15-25 words) naming the core flaw.
- short_summary: same sentence as one_sentence_takeaway.
- target_agent: the role (or "Strongest argument" / "Unresolved question") you are challenging.
- target_kind: one of "peer", "strongest_argument", "unresolved_question".
- challenge: the core problem with the target (1–2 sentences).
- assumption_attacked: the specific assumption being attacked.
- why_it_breaks: why that assumption fails under real conditions.
- real_world_implication: what changes in practice if your critique holds.
- counterargument: a stronger alternative (1–3 sentences).
- impact: what changes if your counter is accepted (one sentence).
- response: full prose suitable for end users.
"""


# ── 3. Updated synthesis prompt ───────────────────────────────────────────────

def build_updated_synthesis_prompt(
    role: str,
    original_question: str,
    follow_up_question: str,
    previous_synthesis: str,
    followup_responses: list[dict[str, Any]],
    followup_critiques: list[dict[str, Any]],
    reasoning_style: str = "balanced",
    reasoning_depth: str = "normal",
    retrieved_chunks: list[dict] | None = None,
    knowledge_mode: str = "shared_session_docs",
    knowledge_strict: bool = False,
    debate_summary: dict[str, Any] | None = None,
    cycle_memories: list[dict[str, Any]] | None = None,
) -> str:
    depth = {
        "shallow": "Be concise.",
        "normal": "Be thorough.",
        "deep": "Be exhaustive.",
    }.get(reasoning_depth, "Be thorough.")

    style = {
        "analytical": "Synthesize analytically based on evidence.",
        "creative": "Synthesize creatively, surfacing emerging insights.",
        "devil_advocate": "Synthesize while keeping the strongest counter-views in view.",
        "balanced": "Synthesize in a balanced, fair way.",
    }.get(reasoning_style, "Synthesize in a balanced, fair way.")

    resp_block = "\n".join(
        [
            f"- {_compact(r.get('role', 'agent'), 40)}: {_compact(r.get('answer', ''), 200)}"
            for r in (followup_responses or [])
            if r.get("answer")
        ][:6]
    ) or "(no follow-up responses available)"

    crit_block = "\n".join(
        [
            f"- {_compact(c.get('role', 'agent'), 40)} → {_compact(c.get('target', ''), 30)}: {_compact(c.get('challenge', ''), 200)}"
            for c in (followup_critiques or [])
            if c.get("challenge")
        ][:6]
    ) or "(no follow-up critiques available)"

    chunks = retrieved_chunks or []
    ctx = _format_context_block(chunks)
    knw = _knowledge_instruction(knowledge_mode, knowledge_strict, bool(chunks))
    summary_block = _format_debate_summary(debate_summary)
    cycles_block = _format_cycle_memories(cycle_memories)

    return f"""You are a debate participant with the role: {role}. The debate is ongoing.

Original debate question: {_compact(original_question, 240)}

Previous synthesis (the conclusion before this follow-up cycle):
{_compact(previous_synthesis, 600)}
{summary_block}{cycles_block}
The user just asked a follow-up question:
"{_compact(follow_up_question, 400)}"

Follow-up responses from agents:
{resp_block}

Follow-up critiques between agents:
{crit_block}
{knw}{ctx}
Your task — produce an UPDATED synthesis that explicitly states whether the
conclusion changed compared to the previous synthesis, and WHY. Be honest:
saying "no, it did not change" is a valid answer when the new evidence does not
shift the position.

Decision rule (mandatory):
- You MUST resolve the cycle by choosing a dominant position OR explicitly state
  that no resolution is possible (and why). NO neutral, generic, hedging text.
- You MUST identify a single key trade-off, the winning argument, the losing
  argument, and your overall confidence (low | medium | high).

Reasoning style: {style}
{depth}
{_OUTPUT_CONTRACT}
Required JSON fields:
- one_sentence_takeaway: ONE complete sentence (15-25 words) capturing the updated conclusion.
- short_summary: same sentence as one_sentence_takeaway.
- updated_conclusion: the refined conclusion after this follow-up cycle.
- conclusion_changed: exactly "yes" or "no".
- change_reason: 1–2 sentences explaining WHY the conclusion changed (or why it did not).
- key_tradeoff: the single key trade-off that decided this update.
- winning_argument: the argument that prevailed and why.
- losing_argument: the strongest argument that did NOT prevail and why.
- confidence: one of "low", "medium", "high".
- what_changed: what the new question shifted (or confirmed) — 1–2 sentences.
- strongest_argument: the single argument that did the most work this cycle.
- remaining_disagreement: open questions or unresolved tensions.
- response: full prose suitable for end users.
"""
