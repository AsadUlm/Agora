"""Centralized reasoning-style instruction mapping.

Single source of truth for translating a free-form ``reasoning_style`` value
(set on each agent) into a short prompt-builder instruction. Used by every
round (1, 2, 3) and the follow-up cycle prompts so all phases stay consistent.

Style values are case-insensitive and tolerate hyphens, underscores, spaces
and the common apostrophe variant of *devil's advocate*. Unknown values fall
back to the ``balanced`` instruction.

A *verb* selects the surrounding action context:

- ``"reason"``       — opening / round-1 / follow-up answer
- ``"critique"``     — round-2 critiques, follow-up critiques
- ``"synthesize"``   — round-3, follow-up synthesis
- ``"reflect"``      — generic reflective contexts (legacy alias for reason)
"""

from __future__ import annotations


# Canonical style keys used internally.
_STYLE_ALIASES: dict[str, str] = {
    "analytical": "analytical",
    "analytic": "analytical",
    "creative": "creative",
    "critical": "critical",
    "balanced": "balanced",
    "neutral": "balanced",
    "socratic": "socratic",
    "devils_advocate": "devil_advocate",
    "devil_advocate": "devil_advocate",
    "devils-advocate": "devil_advocate",
    "devil-advocate": "devil_advocate",
    "strategic": "strategic",
    "policy_oriented": "policy_oriented",
    "policy-oriented": "policy_oriented",
    "evidence_based": "evidence_based",
    "evidence-based": "evidence_based",
    "ethical": "ethical",
    "technical": "technical",
    "pragmatic": "pragmatic",
    "risk_focused": "risk_focused",
    "risk-focused": "risk_focused",
}


# (verb, style) → instruction line. Falls back through the chain
# (verb, style) → ("reason", style) → ("reason", "balanced").
_INSTRUCTIONS: dict[tuple[str, str], str] = {
    # ── reason / reflect (opening, round-1, follow-up answer) ────────────
    ("reason", "analytical"): "Reason analytically. Focus on evidence and logical structure.",
    ("reason", "creative"): "Reason creatively. Explore unconventional angles and possibilities.",
    ("reason", "critical"): "Reason critically. Pressure-test claims and surface weak assumptions.",
    ("reason", "balanced"): "Reason in a balanced way. Acknowledge multiple perspectives.",
    ("reason", "socratic"): "Reason Socratically. Probe with questions before asserting conclusions.",
    ("reason", "devil_advocate"): "Stay contrarian. Defend the unpopular position with the strongest steel-man.",
    ("reason", "strategic"): "Reason strategically. Focus on long-term consequences, incentives, trade-offs, and competitive positioning.",
    ("reason", "policy_oriented"): "Reason as a policy expert. Focus on governance, regulation, institutional feasibility, and public impact.",
    ("reason", "evidence_based"): "Reason evidence-first. Prioritize evidence and citations when available, and clearly distinguish facts from assumptions.",
    ("reason", "ethical"): "Reason ethically. Focus on fairness, rights, responsibility, harm prevention, and moral trade-offs.",
    ("reason", "technical"): "Reason technically. Focus on technical feasibility, system design, implementation constraints, and engineering risks.",
    ("reason", "pragmatic"): "Reason pragmatically. Focus on practical implementation, real-world constraints, cost, usability, and realistic compromise.",
    ("reason", "risk_focused"): "Reason in risk terms. Identify failure modes, misuse potential, and mitigation strategies.",

    # ── critique (round-2, follow-up critique) ───────────────────────────
    ("critique", "analytical"): "Critique analytically — focus on logical consistency and evidence gaps.",
    ("critique", "creative"): "Challenge creatively — expose hidden assumptions and alternative framings.",
    ("critique", "critical"): "Critique sharply — name the assumption, show why it breaks, state the consequence.",
    ("critique", "balanced"): "Critique fairly — acknowledge strengths before identifying weaknesses.",
    ("critique", "socratic"): "Critique by interrogating — ask the questions that expose the weakest premise.",
    ("critique", "devil_advocate"): "Critique aggressively — assume the position is wrong and prove it.",
    ("critique", "strategic"): "Critique strategically — attack long-term consequences, incentives, and competitive blind spots.",
    ("critique", "policy_oriented"): "Critique from a policy lens — attack feasibility, governance gaps, and unintended public impact.",
    ("critique", "evidence_based"): "Critique the evidence — name unsupported claims and demand citations where missing.",
    ("critique", "ethical"): "Critique ethically — surface harm, unfairness, rights violations, and moral trade-offs ignored.",
    ("critique", "technical"): "Critique technically — attack feasibility, system design, and engineering risk omissions.",
    ("critique", "pragmatic"): "Critique pragmatically — attack cost, usability, and gap between proposal and implementation reality.",
    ("critique", "risk_focused"): "Critique through risk — surface failure modes, misuse paths, and missing mitigations.",

    # ── synthesize (round-3, follow-up synthesis) ────────────────────────
    ("synthesize", "analytical"): "Synthesize analytically based on the evidence presented.",
    ("synthesize", "creative"): "Synthesize creatively, surfacing emerging insights and reframings.",
    ("synthesize", "critical"): "Synthesize critically — pick the surviving claims and explain why others failed.",
    ("synthesize", "balanced"): "Synthesize in a balanced, nuanced way.",
    ("synthesize", "socratic"): "Synthesize by stating the question the debate ultimately answered, then the answer.",
    ("synthesize", "devil_advocate"): "Acknowledge what challenged your contrarian position most, and where it still holds.",
    ("synthesize", "strategic"): "Synthesize strategically — converge on the long-term winning move given trade-offs surfaced.",
    ("synthesize", "policy_oriented"): "Synthesize as a policy recommendation — concrete, governance-feasible, implementable.",
    ("synthesize", "evidence_based"): "Synthesize evidence-first — anchor the final position in what was actually supported.",
    ("synthesize", "ethical"): "Synthesize ethically — name the moral trade-offs and which value the final position prioritizes.",
    ("synthesize", "technical"): "Synthesize technically — converge on the most feasible system-level answer.",
    ("synthesize", "pragmatic"): "Synthesize pragmatically — pick the implementable answer with the best cost/benefit.",
    ("synthesize", "risk_focused"): "Synthesize through risk — pick the answer with the most tolerable failure profile.",
}

# Verb-agnostic terse forms (used by depth-limited contexts, e.g. critique
# "Be concise" prompts in followup_prompts) — alias to longer ones.
for _style in {s for _, s in _INSTRUCTIONS}:
    _INSTRUCTIONS.setdefault(("reflect", _style), _INSTRUCTIONS[("reason", _style)])


def normalize_style(style: str | None) -> str:
    """Normalize a free-form style value to its canonical key.

    Strips apostrophes (straight ``'`` and curly ``’``) so values like
    ``"Devil's Advocate"`` map to the canonical ``devil_advocate`` key
    instead of silently falling back to ``balanced``.
    """
    if not style:
        return "balanced"
    cleaned = style.strip().lower().replace("\u2019", "").replace("'", "")
    key = cleaned.replace(" ", "_")
    return _STYLE_ALIASES.get(key, _STYLE_ALIASES.get(key.replace("_", "-"), "balanced"))


def style_instruction(verb: str, style: str | None) -> str:
    """Return the prompt instruction for ``style`` in the given ``verb`` context.

    Unknown styles → balanced. Unknown verbs → ``reason``.
    """
    canonical = normalize_style(style)
    if (verb, canonical) in _INSTRUCTIONS:
        return _INSTRUCTIONS[(verb, canonical)]
    if ("reason", canonical) in _INSTRUCTIONS:
        return _INSTRUCTIONS[("reason", canonical)]
    return _INSTRUCTIONS[("reason", "balanced")]
