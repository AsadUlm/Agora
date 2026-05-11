"""
Retrieval routing — Step 31.

Selects an agent-role-specific :class:`RetrievalStrategy` BEFORE the vector
search runs. The strategy controls:

  * ``candidate_multiplier``     — how many extra chunks to fetch before re-ranking
  * ``role_keywords``            — soft re-rank boost (additive to similarity)
  * ``preferred_doc_types``      — bias toward certain document classifications
  * ``prefer_contradictions``    — when True, prefers chunks contradicting the
                                   current synthesis position
  * ``diversity_weight``         — λ for MMR (0 = pure similarity, 1 = pure diversity)
  * ``max_chunks_per_document``  — hard cap on per-source dominance

Strategies are derived from the agent role (analyst / critic / creative). The
router also reads the running cycle's evidence memory so later cycles
naturally rotate away from already-cited evidence.

This module is pure / deterministic — no I/O, no LLM calls. It is safe to
import from RoundManager without widening the dependency graph.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


# ── Role aliases (match personas.py case-insensitively) ──────────────────────

_ANALYST_ALIASES = {"analyst", "analytical", "strategist", "moderator"}
_CRITIC_ALIASES = {"critic", "skeptic", "adversarial", "devil_advocate"}
_CREATIVE_ALIASES = {"creative", "futurist", "philosopher", "explorer"}


@dataclass(frozen=True)
class RetrievalStrategy:
    """Per-agent retrieval policy applied AFTER the vector search."""

    name: str
    role_keywords: tuple[str, ...] = ()
    preferred_doc_types: tuple[str, ...] = ()
    prefer_contradictions: bool = False
    candidate_multiplier: int = 3
    diversity_weight: float = 0.5
    max_chunks_per_document: int = 2
    keyword_boost: float = 0.06  # similarity points added per matched keyword

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role_keywords": list(self.role_keywords),
            "preferred_doc_types": list(self.preferred_doc_types),
            "prefer_contradictions": self.prefer_contradictions,
            "candidate_multiplier": self.candidate_multiplier,
            "diversity_weight": self.diversity_weight,
            "max_chunks_per_document": self.max_chunks_per_document,
            "keyword_boost": self.keyword_boost,
        }


# ── Built-in strategies ──────────────────────────────────────────────────────


ANALYST_STRATEGY = RetrievalStrategy(
    name="analyst",
    role_keywords=(
        "policy", "framework", "regulation", "implementation", "governance",
        "tradeoff", "trade-off", "constraint", "metric", "evidence",
        "institution", "mechanism", "compliance", "oversight",
    ),
    preferred_doc_types=(
        "policy_report", "academic_paper", "research_summary",
        "legal_document", "strategy_document",
    ),
    prefer_contradictions=False,
    candidate_multiplier=3,
    diversity_weight=0.55,
    max_chunks_per_document=2,
)

CRITIC_STRATEGY = RetrievalStrategy(
    name="critic",
    role_keywords=(
        "fail", "failure", "limitation", "loophole", "unintended", "violation",
        "bypass", "weakness", "risk", "harm", "cost", "exception",
        "enforcement", "adversarial", "challenge", "objection", "counter",
    ),
    preferred_doc_types=(
        "academic_paper", "research_summary", "internal_notes",
        "policy_report", "legal_document",
    ),
    prefer_contradictions=True,
    candidate_multiplier=4,
    diversity_weight=0.7,
    max_chunks_per_document=1,
)

CREATIVE_STRATEGY = RetrievalStrategy(
    name="creative",
    role_keywords=(
        "future", "scenario", "long-term", "transformative", "paradigm",
        "alternative", "speculative", "implication", "system", "emerging",
        "cross-domain", "reframe", "vision", "evolution",
    ),
    preferred_doc_types=(
        "strategy_document", "research_summary", "academic_paper",
        "news_article", "internal_notes",
    ),
    prefer_contradictions=False,
    candidate_multiplier=4,
    diversity_weight=0.75,
    max_chunks_per_document=1,
)

DEFAULT_STRATEGY = RetrievalStrategy(
    name="default",
    role_keywords=(),
    preferred_doc_types=(),
    prefer_contradictions=False,
    candidate_multiplier=2,
    diversity_weight=0.4,
    max_chunks_per_document=2,
)


# ── Router ───────────────────────────────────────────────────────────────────


def select_strategy(
    role: str | None,
    *,
    cycle_number: int = 1,
    evidence_memory: Mapping[str, Any] | None = None,
) -> RetrievalStrategy:
    """Pick a retrieval strategy for the given agent role.

    The router slightly amplifies diversity in later cycles (so follow-ups
    pull complementary evidence) and slightly amplifies contradiction
    preference when the synthesis already has uncontested claims that
    deserve pressure-testing.
    """
    base = _strategy_for_role(role)

    if cycle_number <= 1:
        return base

    diversity_boost = min(0.2, 0.05 * (cycle_number - 1))
    new_diversity = min(0.95, base.diversity_weight + diversity_boost)

    has_strongest = bool(_safe_list(evidence_memory, "strongest_evidence"))
    no_disputes = not bool(_safe_list(evidence_memory, "disputed_evidence"))
    prefer_contradictions = base.prefer_contradictions or (has_strongest and no_disputes)

    return RetrievalStrategy(
        name=f"{base.name}+cycle{cycle_number}",
        role_keywords=base.role_keywords,
        preferred_doc_types=base.preferred_doc_types,
        prefer_contradictions=prefer_contradictions,
        candidate_multiplier=base.candidate_multiplier,
        diversity_weight=new_diversity,
        max_chunks_per_document=base.max_chunks_per_document,
        keyword_boost=base.keyword_boost,
    )


def _strategy_for_role(role: str | None) -> RetrievalStrategy:
    if not role:
        return DEFAULT_STRATEGY
    key = role.strip().lower()
    if key in _ANALYST_ALIASES:
        return ANALYST_STRATEGY
    if key in _CRITIC_ALIASES:
        return CRITIC_STRATEGY
    if key in _CREATIVE_ALIASES:
        return CREATIVE_STRATEGY
    return DEFAULT_STRATEGY


def _safe_list(payload: Mapping[str, Any] | None, key: str) -> list[Any]:
    if not payload:
        return []
    val = payload.get(key)
    return list(val) if isinstance(val, (list, tuple)) else []


__all__ = [
    "RetrievalStrategy",
    "ANALYST_STRATEGY",
    "CRITIC_STRATEGY",
    "CREATIVE_STRATEGY",
    "DEFAULT_STRATEGY",
    "select_strategy",
]
