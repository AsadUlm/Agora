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
]
