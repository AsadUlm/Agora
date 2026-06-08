"""Step 28 — shared argument-quality constraints.

Single source of truth for the high-level reasoning quality bar that every
debate prompt (Round 1/2/3 + follow-up cycles) must enforce. Centralising
these blocks here means improving them once propagates everywhere, and keeps
individual prompt builders short.

Three reusable building blocks are exported:

  * ``QUALITY_REQUIREMENTS_BLOCK`` — bans generic filler, requires concrete
    mechanisms / actors / outcomes, and lists representative domain anchors
    (healthcare AI, autonomous weapons, compute thresholds, …) so agents pick
    real references instead of vague abstractions.

  * ``CONTINUITY_REQUIREMENTS_BLOCK`` — for follow-up rounds only. Forces the
    agent to explicitly reference at least one prior argument or unresolved
    question from the supplied debate snapshot, so cycle N feels like a
    continuation of cycle N-1 instead of a fresh chat.

  * ``DEBUG_METADATA_BLOCK`` — declares the optional ``debug_metadata`` field
    used by raw / debug consumers. Backward compatible: agents that omit it
    are not penalised, but encouraging it improves observability.
"""

from __future__ import annotations


# ── 1. Universal quality bar (Round 1/2/3 + follow-up) ────────────────────────

QUALITY_REQUIREMENTS_BLOCK = """
Argument quality bar (mandatory):
- Every key claim MUST cite a concrete mechanism, actor, scenario, or numeric
  threshold. Vague abstractions without an operational hook are forbidden.
- Prefer at least one specific domain anchor where it fits the question:
  healthcare AI, autonomous weapons, financial AI, critical infrastructure,
  open-source foundation models, compute thresholds (e.g. > 10^25 FLOPs),
  pre-deployment licensing, model evaluations, third-party audits, liability
  rules, jurisdictional arbitrage.
- Banned filler (do not use unless immediately followed by a specific
  mechanism that justifies it): "AI is transformative", "balance innovation
  and safety", "careful regulation is needed", "governments must act",
  "stakeholders should collaborate".
- Replace abstract claims with operational ones. Bad: "Regulation slows
  innovation." Good: "Mandatory pre-deployment licensing would impose audit
  costs that small open-source labs cannot absorb without enterprise sponsors."
- Take a position. Hedging without a stated trade-off is a failure mode.
""".strip()


# ── 2. Cross-cycle continuity (follow-up rounds only) ─────────────────────────

CONTINUITY_REQUIREMENTS_BLOCK = """
Continuity bar (mandatory for follow-up cycles):
- This is NOT a new debate. You MUST treat the supplied debate snapshot and
  prior cycle summaries as canonical context.
- Explicitly reference at least one of: a prior synthesis claim, a peer's
  strongest previous argument, or an unresolved question from the snapshot.
  Generic statements that ignore the snapshot are a failure mode.
- If your position evolved, name what specifically changed your mind (a new
  argument, a counterexample, the new follow-up question itself). If it did
  not evolve, explain why the new question does not actually move the
  debate — do not just restate the previous synthesis.
- Allowed evolution patterns: refinement, partial concession, scope
  narrowing (e.g. accepting regulation only for autonomous weapons while
  rejecting broad licensing), strategic adjustment, escalation.
""".strip()


# ── 3. Optional structured debug metadata ─────────────────────────────────────

DEBUG_METADATA_BLOCK = """
Optional `debug_metadata` field (recommended, never required):
- referenced_prior_arguments: array of short strings naming arguments from
  earlier rounds you explicitly built on or attacked.
- challenged_assumptions: array of short strings naming assumptions you tried
  to break in this answer.
- position_shift: short string — one of "no_change", "refined", "narrowed",
  "broadened", "concession", "reversal".
- resolved_conflicts: array of short strings naming snapshot conflicts your
  answer settled (or "" if none).
- remaining_conflicts: array of short strings naming conflicts that remain
  open after your answer.
This metadata is only consumed by raw/debug views and never shown to end
users — keep entries short (≤ 15 words each).
""".strip()


__all__ = [
    "QUALITY_REQUIREMENTS_BLOCK",
    "CONTINUITY_REQUIREMENTS_BLOCK",
    "DEBUG_METADATA_BLOCK",
    "FACTUALITY_BLOCK",
    "FIELD_DIFFERENTIATION_BLOCK",
    "FOLLOWUP_ADAPTATION_BLOCK",
    "evidence_mode_block",
    "ASSUMPTION_LABELING_BLOCK",
    "ANTI_STRAWMAN_BLOCK",
]


# ── 4. Anti-hallucination factuality bar ──────────────────────────────────────

FACTUALITY_BLOCK = """
Factuality bar (mandatory):
- Do NOT fabricate statistics, percentages, dollar figures, dates, study
  citations, or named experts. If you do not have the exact figure, use a
  qualitative description instead ("a sizeable share", "a documented gap",
  "studies have shown") rather than inventing precision.
- When you cite a real referent (a known law, regulator, framework, or
  widely reported event), name it generically and only at the level you are
  confident about. Prefer "EU AI Act risk-tier framework" over an invented
  article number.
- Concrete domain anchors (compute thresholds, deployment categories,
  enforcement mechanisms) ARE encouraged when they describe how something
  works — that is mechanism reasoning, not a factual claim that could be
  falsified by a fact-checker.
- If a claim depends on data you cannot verify, mark it explicitly:
  "(estimate)", "(directional)", "(if reported numbers hold)".
- BANNED phrasings that fabricate precision (do not use unless an evidence
  document directly supports the exact number):
    * "20-50% compliance cost premium"
    * "$10-50M per audit"
    * "99% of startup workflows"
    * "10x proliferation"
    * "80% of top entries"
    * "as documented by ...", "per report ...", "historical precedent shows ..."
      followed by an unsupported specific.
- Allowed qualitative substitutes:
    * "could increase compliance costs"
    * "may create barriers for smaller labs"
    * "could encourage some firms to relocate"
    * "in some cases", "a plausible risk is ...",
      "the exact magnitude would depend on implementation".
- If you need a number but no evidence is provided, state the relationship
  qualitatively (direction, mechanism). Do not invent fake precision.
""".strip()


# ── 5. Field-differentiation rules to prevent identical text reuse ────────────

FIELD_DIFFERENTIATION_BLOCK = """
Field-differentiation bar (mandatory):
- Each required JSON field has a distinct purpose. Do NOT copy the same
  sentence across multiple fields.
- one_sentence_takeaway: exactly ONE sentence, ≤ 24 words, plain conclusion.
  No mechanism, no example, no caveat list — just the headline.
- short_summary: 2 distinct sentences. MUST NOT duplicate the takeaway.
  MUST add at least one supporting reason, mechanism, condition, or
  trade-off that the takeaway omits.
- response: 4-6 paragraphs of polished natural prose. MUST contain material
  the takeaway and short_summary do not. MUST NOT be a concatenation of
  the other JSON fields (takeaway + answer_to_followup + key_points stitched
  together is a quality failure). Write it as a single coherent answer.
- key_points: 3-5 bullets. MUST NOT duplicate the first sentence of response
  or restate the takeaway verbatim.
- Anti-pattern: making `response` literally the same paragraph as
  `short_summary` or repeating `one_sentence_takeaway` verbatim inside the
  response opening — both are quality failures.
""".strip()


# ── 6. Follow-up adaptation: answer the new question first ────────────────────

FOLLOWUP_ADAPTATION_BLOCK = """
Follow-up adaptation bar (mandatory for follow-up cycles):
- The FIRST paragraph of `response` MUST directly answer the user's new
  follow-up question, not restate your previous position. Treat the new
  question as the primary prompt; prior context is supporting material.
- Only AFTER answering the new question may you connect it back to your
  prior position (refining, narrowing, conceding, escalating, or holding).
- `position_evolution.reason` MUST mention the actual content of the new
  follow-up question (or a peer argument from the latest cycle). Generic
  reasons like "no new evidence emerged" or "the question did not change my
  view" without naming what was considered are a failure mode.
- If the follow-up surfaces information that contradicts your earlier
  stance, you MUST acknowledge it — silent contradictions break trust.
""".strip()


# ── 7. Evidence mode awareness (RAG vs reasoning-only) ────────────────────────

def evidence_mode_block(has_evidence: bool) -> str:
    """Build a prompt block that tells the agent whether RAG is active.

    When ``has_evidence`` is True, agents should anchor concrete factual
    claims in the supplied evidence. When False, agents are explicitly told
    they are in reasoning-only mode and must not invent precise statistics.
    """
    if has_evidence:
        return (
            "Evidence mode: RAG active.\n"
            "- Use the provided evidence/document context as your primary anchor "
            "for any concrete factual claim (numbers, dates, named studies).\n"
            "- Do NOT ignore the supplied evidence when it is relevant to the "
            "question — engage with it directly, even if you ultimately disagree.\n"
            "- Do NOT invent sources outside the supplied context. If a claim is "
            "not supported by the supplied evidence, mark it as reasoning, not fact.\n"
            "- Cite by [E#] labels (e.g. [E1], [E2]) — do not fabricate citation\n"
            "  labels that were not given to you and do not invent article numbers,\n"
            "  DOIs, or page numbers.\n"
            "- If the supplied evidence is insufficient to answer the question, "
            "say so explicitly instead of guessing.\n"
        )
    return (
        "Evidence mode: reasoning-only.\n"
        "- No external documents were provided for this debate.\n"
        "- You may reason from general knowledge and policy principles, but you "
        "MUST NOT invent precise statistics, study results, dollar amounts, "
        "percentages, timelines, or named factual claims.\n"
        "- Use qualitative phrasing ('a sizeable share', 'a documented gap', "
        "'plausibly increases costs') unless a fact is common, stable, and "
        "clearly part of public knowledge.\n"
        "- Mark assumptions explicitly as assumptions, not facts.\n"
    )


# ── 8. Assumption labeling for reasoning-only mode ────────────────────────────

ASSUMPTION_LABELING_BLOCK = """
Assumption labeling (recommended in reasoning-only mode):
- When you reason without supporting documents, separate the four layers
  inside `response` so the user can see what is claim, what is assumption,
  what is mechanism, and what is trade-off:
    1. Policy claim — the position you are defending.
    2. Assumption — what must be true for the claim to hold.
    3. Mechanism — who acts, how the rule attaches, what changes.
    4. Trade-off — what gets worse if the claim is enforced.
- This labeling does NOT have to use the literal headers; weaving them into
  prose is fine. The point is that the four layers must be discernible.
- Example:
    Policy claim: High-risk deployment should be regulated.
    Assumption: Deployment chokepoints are more enforceable than model-training controls.
    Mechanism: The rule attaches to hospitals, defense procurement, financial exchanges, or infrastructure operators.
    Trade-off: This protects safety-critical contexts but may leave foreign or covert deployments outside enforcement.
""".strip()


# ── 9. Anti-strawman guard for critique rounds ────────────────────────────────

ANTI_STRAWMAN_BLOCK = """
Anti-strawman rule (mandatory for critique rounds):
- The FIRST sentence of `challenge` MUST quote or accurately paraphrase a
  specific claim made by the target agent. Use phrases like
  "You argued that ...", "Your position was ...", "You claimed that ...".
- Do NOT attack a generic version of the opponent's ideology or a position
  they never stated.
- Do NOT use the phrase "you ignored" unless you can cite the specific
  claim the target made that contradicts your charge.
- If the opponent argued for deployment-level regulation, do not critique
  them as if they argued only for global training-compute verification.
  Match the actual scope of their claim.
- Before writing the counterargument, identify in this order:
    1. The exact target claim (quote or close paraphrase).
    2. The assumption behind that claim.
    3. Why that assumption may fail in practice.
""".strip()

