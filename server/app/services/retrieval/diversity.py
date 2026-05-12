"""
Retrieval diversity engine — Step 31.

Re-ranks vector-search hits to satisfy a :class:`RetrievalStrategy`:

  * Source balancing — caps chunks per document so a single source cannot
    dominate the prompt.
  * Maximum Marginal Relevance (MMR) — selects chunks that are simultaneously
    relevant to the query AND novel relative to already-selected chunks.
  * Role keyword boosting — additive bonus for chunks whose text matches the
    role's keyword bank (analyst → policy/framework/…, critic → fail/risk/…).

Inter-chunk similarity is computed via word-shingle Jaccard on the chunk text
(no second embedding pass — the existing query embedding has already filtered
the candidate pool to relevant items).

The module is import-safe: it only depends on ``RetrievedChunk`` and
``RetrievalStrategy``. No DB, no LLM, no I/O.
"""

from __future__ import annotations

import re
from typing import Iterable

from app.schemas.contracts import RetrievedChunk
from app.services.retrieval.router import RetrievalStrategy


_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if len(t) > 2}


def _shingles(text: str, n: int = 4) -> set[str]:
    words = [t.lower() for t in _TOKEN_RE.findall(text or "")]
    if len(words) < n:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


# ── Public API ───────────────────────────────────────────────────────────────


def boost_with_keywords(
    chunks: list[RetrievedChunk],
    strategy: RetrievalStrategy,
) -> list[RetrievedChunk]:
    """Add a small relevance bonus to chunks whose text matches role keywords.

    Returns NEW chunk records — input is not mutated. The returned list keeps
    the original order; downstream callers re-sort by ``similarity_score``.
    """
    if not strategy.role_keywords or not chunks:
        return list(chunks)

    keywords = tuple(k.lower() for k in strategy.role_keywords)
    boosted: list[RetrievedChunk] = []
    for chunk in chunks:
        text_lower = (chunk.content or "").lower()
        hits = sum(1 for kw in keywords if kw in text_lower)
        if hits == 0:
            boosted.append(chunk)
            continue
        bonus = min(hits * strategy.keyword_boost, 0.25)
        new_score = min(1.0, chunk.similarity_score + bonus)
        boosted.append(
            chunk.model_copy(update={"similarity_score": new_score})
        )
    return boosted


def enforce_source_balance(
    chunks: Iterable[RetrievedChunk],
    *,
    max_per_document: int,
) -> list[RetrievedChunk]:
    """Cap chunks-per-document. Preserves order, drops excess from each source."""
    if max_per_document <= 0:
        return [c for c in chunks]
    counts: dict = {}
    out: list[RetrievedChunk] = []
    for c in chunks:
        n = counts.get(c.document_id, 0)
        if n >= max_per_document:
            continue
        counts[c.document_id] = n + 1
        out.append(c)
    return out


def apply_mmr(
    chunks: list[RetrievedChunk],
    *,
    top_k: int,
    diversity_weight: float = 0.5,
) -> list[RetrievedChunk]:
    """Greedy Maximal Marginal Relevance selection.

    Score for each candidate = (1 - λ) · similarity − λ · max_overlap_with_selected.

    λ = ``diversity_weight`` ∈ [0, 1]. λ=0 returns top-k by similarity (no
    diversity), λ=1 prefers maximally novel chunks.
    """
    if top_k <= 0 or not chunks:
        return []
    if len(chunks) <= top_k:
        return list(chunks)

    # Pre-compute shingles once.
    shingles = [_shingles(c.content) for c in chunks]
    remaining = list(range(len(chunks)))
    selected_idx: list[int] = []

    # Start with the highest-relevance chunk.
    first = max(remaining, key=lambda i: chunks[i].similarity_score)
    selected_idx.append(first)
    remaining.remove(first)

    while remaining and len(selected_idx) < top_k:
        best_i = remaining[0]
        best_score = -1e9
        for i in remaining:
            sim = chunks[i].similarity_score
            max_overlap = max(
                _jaccard(shingles[i], shingles[s]) for s in selected_idx
            )
            score = (1.0 - diversity_weight) * sim - diversity_weight * max_overlap
            if score > best_score:
                best_score = score
                best_i = i
        selected_idx.append(best_i)
        remaining.remove(best_i)

    selected_idx.sort(
        key=lambda i: chunks[i].similarity_score, reverse=True,
    )
    return [chunks[i] for i in selected_idx]


def apply_strategy(
    chunks: list[RetrievedChunk],
    strategy: RetrievalStrategy,
    *,
    top_k: int,
) -> list[RetrievedChunk]:
    """Pipeline: keyword boost → source balance → MMR → trim to top_k.

    Returns at most ``top_k`` chunks. Safe for empty inputs.
    """
    if not chunks:
        return []

    boosted = boost_with_keywords(chunks, strategy)
    boosted.sort(key=lambda c: c.similarity_score, reverse=True)

    balanced = enforce_source_balance(
        boosted, max_per_document=strategy.max_chunks_per_document
    )

    diverse = apply_mmr(
        balanced,
        top_k=top_k,
        diversity_weight=strategy.diversity_weight,
    )
    return diverse[:top_k]


__all__ = [
    "apply_strategy",
    "apply_mmr",
    "boost_with_keywords",
    "enforce_source_balance",
]
