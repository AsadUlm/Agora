"""
Conflict selector for Round 2 — deterministic conflict-pair ranking.

Replaces the naive all-vs-all generation with a targeted selection
that only pairs agents whose Round 1 stances genuinely disagree.

Algorithm:
    1. For every unique (i, j) pair compute a conflict score based on
       stance polarity, confidence distance, and key-point overlap.
    2. Rank pairs by descending conflict score.
    3. Greedily select top-K pairs, enforcing a per-agent appearance cap
       so no single agent dominates the round.
    4. Return each selected pair as two directed exchanges (A→B and B→A).

The scoring is fully deterministic — no LLM calls are made here.
"""

from __future__ import annotations

import logging
from collections import Counter

logger = logging.getLogger(__name__)

# Maximum number of *unique* pairs to retain.  Each pair generates TWO
# directed exchanges (A challenges B, B challenges A).
DEFAULT_MAX_PAIRS = 3

# Maximum number of unique pairs any single agent may participate in.
# Prevents one highly-controversial agent from appearing in every exchange.
DEFAULT_MAX_AGENT_APPEARANCES = 2

# ── Polarity keywords used for cheap stance classification ──────────────────
_POSITIVE_SIGNALS = frozenset({
    "support", "agree", "favour", "favor", "advocate", "endorse",
    "promote", "benefit", "pro", "yes", "effective", "necessary",
    "strongly support", "recommend",
})
_NEGATIVE_SIGNALS = frozenset({
    "oppose", "disagree", "against", "reject", "risk", "danger",
    "harmful", "caution", "concern", "no", "ineffective", "unnecessary",
    "strongly oppose",
})


def _polarity(stance: str) -> float:
    """
    Return a rough polarity score in [-1.0, 1.0].

    Positive → supports / favours the proposition.
    Negative → opposes / warns against it.
    Zero     → neutral or unclassifiable.
    """
    lower = stance.lower()
    pos_hits = sum(1 for kw in _POSITIVE_SIGNALS if kw in lower)
    neg_hits = sum(1 for kw in _NEGATIVE_SIGNALS if kw in lower)
    total = pos_hits + neg_hits
    if total == 0:
        return 0.0
    return (pos_hits - neg_hits) / total


def _key_point_overlap(kp_a: list[str], kp_b: list[str]) -> float:
    """
    Jaccard similarity of key-point token bags (case-insensitive).

    Returns 0.0 when no overlap, 1.0 when identical.
    """
    def _tokens(points: list[str]) -> set[str]:
        return {w.lower() for p in points for w in p.split()}

    set_a = _tokens(kp_a)
    set_b = _tokens(kp_b)
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def _conflict_score(a: dict, b: dict) -> float:
    """
    Compute a composite conflict score for a pair of Round 1 results.

    Components (weighted sum):
      • Polarity distance  — 0.0 (same side) to 2.0 (full opposition)  × 0.50
      • Confidence gap      — abs difference in [0, 1]                   × 0.30
      • Key-point divergence — 1 - Jaccard overlap                       × 0.20

    Higher is more conflicted.
    """
    pol_a = _polarity(a.get("stance", ""))
    pol_b = _polarity(b.get("stance", ""))
    polarity_dist = abs(pol_a - pol_b)  # 0–2

    conf_a = float(a.get("confidence", 0.5))
    conf_b = float(b.get("confidence", 0.5))
    conf_gap = abs(conf_a - conf_b)

    overlap = _key_point_overlap(
        a.get("key_points", []),
        b.get("key_points", []),
    )
    divergence = 1.0 - overlap

    score = 0.50 * polarity_dist + 0.30 * conf_gap + 0.20 * divergence
    return score


def select_conflict_pairs(
    round1_results: list[dict],
    *,
    max_pairs: int = DEFAULT_MAX_PAIRS,
    max_agent_appearances: int = DEFAULT_MAX_AGENT_APPEARANCES,
) -> list[tuple[dict, dict]]:
    """
    Return the most conflicted agent pairs, ranked by composite score.

    Uses greedy selection with a per-agent appearance cap so no single
    agent dominates the exchanges.  Each selected pair yields TWO directed
    exchanges (A challenges B, B challenges A).

    Args:
        round1_results:       Output of generate_round1 — list of per-agent dicts.
        max_pairs:            Maximum unique pairs to keep.
        max_agent_appearances: Maximum pairs any single agent may participate in.

    Returns:
        List of (challenger, responder) tuples — at most ``2 * max_pairs``
        directed entries.
    """
    n = len(round1_results)
    if n < 2:
        return []

    # Compute scores for every unique pair.
    scored: list[tuple[float, int, int]] = []
    for i in range(n):
        for j in range(i + 1, n):
            score = _conflict_score(round1_results[i], round1_results[j])
            scored.append((score, i, j))

    # Sort descending by score (stable — on tie, earlier pair wins).
    scored.sort(key=lambda t: t[0], reverse=True)

    # Greedy selection: pick highest-scoring pairs while respecting caps.
    appearances: Counter[int] = Counter()
    chosen: list[tuple[float, int, int]] = []

    for score, i, j in scored:
        if len(chosen) >= max_pairs:
            break
        if appearances[i] >= max_agent_appearances or appearances[j] >= max_agent_appearances:
            continue
        chosen.append((score, i, j))
        appearances[i] += 1
        appearances[j] += 1

    # Expand to two directed exchanges each.
    selected: list[tuple[dict, dict]] = []
    for score, i, j in chosen:
        a, b = round1_results[i], round1_results[j]
        logger.debug(
            "Conflict pair: %s vs %s — score=%.3f",
            a.get("role", "?"),
            b.get("role", "?"),
            score,
        )
        selected.append((a, b))
        selected.append((b, a))

    return selected
