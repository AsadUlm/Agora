"""Evidence packets — Step 29.

Wraps raw `RetrievedChunk` objects into structured `EvidencePacket` records
so prompts can reference evidence by stable citation labels (`[E1]`, `[E2]`)
and agents can reason about source reliability, key claims, and conflicts.

The module is intentionally side-effect-free besides one DB read per call:
it loads the `Document` rows for the chunk set in a single query and groups
chunks by document. Packets are produced after de-duplication and source
diversification so the prompt does not waste tokens on near-identical text
from the same file.

Key public surface:

    build_evidence_packets(db, chunks, *, used_evidence_ids=None,
                           max_packets=4) -> list[EvidencePacket]
    format_evidence_block(packets) -> str

The block format is deliberately compact (≤ ~120 tokens for 4 packets) and
contains only:

    AVAILABLE EVIDENCE
    [E1] <title> | <source_type> | reliability=<label>
        summary: <1–2 sentences>
        key claims:
        - <claim 1>
        - <claim 2>

`format_evidence_block` returns "" when there are no packets, so callers can
unconditionally include it in their f-string.

This module DOES NOT mutate the chunks list and DOES NOT call the LLM.
Claim extraction is done with cheap heuristics (sentence splitting +
length filter); a future iteration may swap in an LLM-based summarizer
behind the same interface.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.schemas.contracts import RetrievedChunk

logger = logging.getLogger(__name__)


# ── Reliability heuristics ────────────────────────────────────────────────────

# Substring → reliability tier. First match wins. Lowercased comparison.
_RELIABILITY_RULES: list[tuple[tuple[str, ...], str]] = [
    (("audit", "regulation", "regulatory", "policy", "government", ".gov"), "HIGH_CONFIDENCE"),
    (("standard", "iso ", "ieee", "rfc"), "HIGH_CONFIDENCE"),
    (("paper", "journal", "study", "research", "arxiv", "doi"), "MODERATE_CONFIDENCE"),
    (("report", "analysis", "review"), "MODERATE_CONFIDENCE"),
    (("blog", "opinion", "forum", "post", "tweet"), "SPECULATIVE"),
    (("draft", "notes", "memo", "personal"), "USER_SUPPLIED"),
]

_SOURCE_TYPE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("audit", "regulation", "regulatory"), "Government / regulatory document"),
    (("policy", ".gov"), "Policy document"),
    (("paper", "journal", "arxiv", "doi"), "Academic paper"),
    (("study", "research"), "Research article"),
    (("report",), "Report"),
    (("blog", "opinion"), "Opinion / blog"),
    (("draft", "notes", "memo"), "Internal note"),
]


def _infer_reliability(filename: str, source_type: str) -> str:
    """Cheap label inference; never fails."""
    haystack = f"{filename} {source_type}".lower()
    for needles, label in _RELIABILITY_RULES:
        if any(n in haystack for n in needles):
            return label
    return "MODERATE_CONFIDENCE"


def _infer_source_type(filename: str, raw_source_type: str) -> str:
    """Map raw source_type / filename to a human-readable category."""
    raw = (raw_source_type or "").strip()
    haystack = f"{filename} {raw}".lower()
    for needles, label in _SOURCE_TYPE_RULES:
        if any(n in haystack for n in needles):
            return label
    if raw:
        return raw
    return "User-uploaded document"


# ── Text helpers ──────────────────────────────────────────────────────────────

_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-ZА-Я])")


def _normalize(text: str) -> str:
    return " ".join(str(text or "").split())


def _split_sentences(text: str) -> list[str]:
    norm = _normalize(text)
    if not norm:
        return []
    parts = _SENT_SPLIT_RE.split(norm)
    return [p.strip() for p in parts if p.strip()]


def _summarize(text: str, max_chars: int = 220) -> str:
    """Take the first 1–2 sentences as a compact summary."""
    sentences = _split_sentences(text)
    if not sentences:
        return ""
    summary = sentences[0]
    if len(summary) < max_chars // 2 and len(sentences) > 1:
        summary = (summary + " " + sentences[1]).strip()
    if len(summary) > max_chars:
        summary = summary[: max_chars - 1].rstrip() + "…"
    return summary


def _extract_key_claims(text: str, max_claims: int = 3, max_chars: int = 160) -> list[str]:
    """Pick the longest informative sentences as claim candidates."""
    sentences = _split_sentences(text)
    candidates = [s for s in sentences if 40 <= len(s) <= 320]
    candidates.sort(key=len, reverse=True)
    out: list[str] = []
    seen: set[str] = set()
    for s in candidates:
        key = s[:60].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s if len(s) <= max_chars else s[: max_chars - 1].rstrip() + "…")
        if len(out) >= max_claims:
            break
    if not out and sentences:
        out.append(sentences[0][:max_chars])
    return out


def _shingles(text: str, n: int = 5) -> set[str]:
    """Word n-gram set for cheap near-duplicate detection."""
    words = re.findall(r"\w+", text.lower())
    if len(words) < n:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + n]) for i in range(len(words) - n + 1)}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


# ── Packet ────────────────────────────────────────────────────────────────────


@dataclass
class EvidencePacket:
    """Structured evidence record consumed by prompts."""

    id: str                       # stable id "doc-<uuid>" — survives across cycles
    citation_label: str           # "E1", "E2", ... — assigned per-prompt
    document_id: uuid.UUID
    source_title: str
    source_type: str
    relevance_score: float
    summary: str
    key_claims: list[str] = field(default_factory=list)
    reliability: str = "MODERATE_CONFIDENCE"
    chunk_ids: list[uuid.UUID] = field(default_factory=list)
    # Step 31 — knowledge intelligence layer (purely additive, all default to
    # neutral values so older callers keep working).
    document_type: str = ""
    document_topics: list[str] = field(default_factory=list)
    confidence_label: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "citation_label": self.citation_label,
            "document_id": str(self.document_id),
            "source_title": self.source_title,
            "source_type": self.source_type,
            "relevance_score": self.relevance_score,
            "summary": self.summary,
            "key_claims": list(self.key_claims),
            "reliability": self.reliability,
            "chunk_ids": [str(c) for c in self.chunk_ids],
            "document_type": self.document_type,
            "document_topics": list(self.document_topics),
            "confidence_label": self.confidence_label,
        }


# ── Builder ───────────────────────────────────────────────────────────────────


def _packet_id_for_document(document_id: uuid.UUID) -> str:
    return f"doc-{document_id}"


async def build_evidence_packets(
    db: AsyncSession,
    chunks: list[RetrievedChunk],
    *,
    used_evidence_ids: Iterable[str] | None = None,
    max_packets: int = 4,
    similarity_dedup_threshold: float = 0.7,
) -> list[EvidencePacket]:
    """Group chunks by document, dedupe near-duplicates, and assign labels.

    Args:
        db: Async SQLAlchemy session.
        chunks: Output from ``RetrievalService.retrieve_for_agent``.
        used_evidence_ids: Packet ids already cited in earlier cycles.
            New evidence is preferred (sorted to the top); already-used
            evidence is still included but down-ranked so the prompt can
            still reference it when it remains the most relevant source.
        max_packets: Hard cap on returned packets (token control).
        similarity_dedup_threshold: Word 5-gram Jaccard threshold above
            which two packets are considered near-duplicates.

    Returns:
        Up to ``max_packets`` packets ordered by usefulness.
        Empty list when ``chunks`` is empty (safe no-op for prompts).
    """
    if not chunks:
        return []

    used_set = {str(x) for x in (used_evidence_ids or [])}

    # 1. Group chunks by document, keeping max similarity per document.
    by_doc: dict[uuid.UUID, dict] = {}
    for c in chunks:
        bucket = by_doc.get(c.document_id)
        if bucket is None:
            by_doc[c.document_id] = {
                "chunks": [c],
                "max_score": c.similarity_score,
            }
        else:
            bucket["chunks"].append(c)
            if c.similarity_score > bucket["max_score"]:
                bucket["max_score"] = c.similarity_score

    # 2. Load Document rows (single query).
    doc_ids = list(by_doc.keys())
    docs_by_id: dict[uuid.UUID, Document] = {}
    try:
        rows = await db.execute(
            select(Document).where(Document.id.in_(doc_ids))
        )
        for d in rows.scalars().all():
            docs_by_id[d.id] = d
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "build_evidence_packets: document metadata fetch failed (%s) — "
            "falling back to ids only",
            exc,
        )

    # 3. Build provisional packets (one per document).
    provisional: list[EvidencePacket] = []
    for doc_id, bucket in by_doc.items():
        doc_chunks: list[RetrievedChunk] = sorted(
            bucket["chunks"], key=lambda c: c.chunk_index
        )
        joined_text = " ".join(c.content for c in doc_chunks if c.content)
        doc = docs_by_id.get(doc_id)
        filename = doc.filename if doc else f"document-{doc_id}"
        raw_source_type = doc.source_type if doc else ""
        source_type = _infer_source_type(filename, raw_source_type)
        reliability = _infer_reliability(filename, raw_source_type)

        # Step 31 — pull knowledge intelligence (best-effort; unknown when
        # extraction was skipped or the document was uploaded before Step 31).
        document_type = ""
        document_topics: list[str] = []
        if doc is not None:
            document_type = (doc.document_type or "").strip()
            km = doc.knowledge_metadata or {}
            if isinstance(km, dict):
                topics = km.get("main_topics") or []
                if isinstance(topics, list):
                    document_topics = [str(t) for t in topics[:3] if t]

        provisional.append(
            EvidencePacket(
                id=_packet_id_for_document(doc_id),
                citation_label="",  # assigned after ranking
                document_id=doc_id,
                source_title=filename,
                source_type=source_type,
                relevance_score=float(bucket["max_score"]),
                summary=_summarize(joined_text),
                key_claims=_extract_key_claims(joined_text),
                reliability=reliability,
                chunk_ids=[c.chunk_id for c in doc_chunks],
                document_type=document_type,
                document_topics=document_topics,
            )
        )

    # 4. Rank: prefer new evidence, then by relevance.
    def _sort_key(p: EvidencePacket) -> tuple[int, float]:
        already_used = 1 if p.id in used_set else 0
        return (already_used, -p.relevance_score)

    provisional.sort(key=_sort_key)

    # 5. Dedupe by content shingles to enforce diversity.
    selected: list[EvidencePacket] = []
    selected_shingles: list[set[str]] = []
    for p in provisional:
        shingles = _shingles(p.summary + " " + " ".join(p.key_claims))
        is_dup = any(
            _jaccard(shingles, prev) >= similarity_dedup_threshold
            for prev in selected_shingles
        )
        if is_dup:
            continue
        selected.append(p)
        selected_shingles.append(shingles)
        if len(selected) >= max_packets:
            break

    # 6. Assign citation labels in final order.
    for i, p in enumerate(selected, start=1):
        p.citation_label = f"E{i}"

    # 7. Step 31 — assign confidence labels across the final packet set.
    assign_confidence_labels(selected)

    return selected


# ── Prompt formatting ─────────────────────────────────────────────────────────


# Step 31 — confidence labels assigned across an evidence set.
CONFIDENCE_STRONG = "STRONG_EVIDENCE"
CONFIDENCE_MODERATE = "MODERATE_EVIDENCE"
CONFIDENCE_SPECULATIVE = "SPECULATIVE"
CONFIDENCE_CONFLICTED = "CONFLICTED"
CONFIDENCE_LIMITED = "LIMITED_SCOPE"


def assign_confidence_labels(packets: list[EvidencePacket]) -> None:
    """Mutates ``packets`` in place to set ``confidence_label`` for each.

    Heuristic-only — never raises. Rules (first match wins per packet):
      * relevance ≥ 0.75 AND ≥ 2 packets share ≥ 1 key-claim shingle  → STRONG
      * relevance < 0.55                                              → SPECULATIVE
      * single packet from a single source                            → LIMITED_SCOPE
      * any other packet contradicts (key-claim Jaccard < 0.2 with    → CONFLICTED
        non-zero overlap on document_topics)
      * otherwise                                                     → MODERATE
    """
    if not packets:
        return

    n = len(packets)
    shingles = [_shingles(" ".join(p.key_claims)) for p in packets]
    distinct_docs = len({p.document_id for p in packets})

    for i, p in enumerate(packets):
        rel = p.relevance_score
        # Compare against other packets
        agrees = 0
        conflicts = 0
        for j in range(n):
            if i == j:
                continue
            sim = _jaccard(shingles[i], shingles[j]) if shingles[i] and shingles[j] else 0.0
            shared_topic = bool(
                set(p.document_topics) & set(packets[j].document_topics)
            )
            if sim >= 0.4:
                agrees += 1
            elif shared_topic and 0.0 < sim < 0.2:
                conflicts += 1

        if rel < 0.55:
            label = CONFIDENCE_SPECULATIVE
        elif conflicts > 0:
            label = CONFIDENCE_CONFLICTED
        elif rel >= 0.75 and agrees >= 1:
            label = CONFIDENCE_STRONG
        elif n == 1 or distinct_docs == 1:
            label = CONFIDENCE_LIMITED
        else:
            label = CONFIDENCE_MODERATE
        p.confidence_label = label


def format_evidence_block(packets: list[EvidencePacket]) -> str:
    """Render packets as a compact AVAILABLE EVIDENCE block.

    Returns "" when ``packets`` is empty so callers can include it
    unconditionally.
    """
    if not packets:
        return ""
    lines = [
        "",
        "AVAILABLE EVIDENCE (cite by label, e.g. [E1]):",
    ]
    for p in packets:
        header = (
            f"[{p.citation_label}] {p.source_title} | "
            f"{p.source_type} | reliability={p.reliability} | "
            f"relevance={p.relevance_score:.2f}"
        )
        if p.confidence_label:
            header += f" | confidence={p.confidence_label}"
        lines.append(header)
        # Step 31 — surface knowledge metadata when present.
        meta_parts: list[str] = []
        if p.document_type:
            meta_parts.append(f"type={p.document_type}")
        if p.document_topics:
            meta_parts.append("topics=" + ", ".join(p.document_topics))
        if meta_parts:
            lines.append("    " + " | ".join(meta_parts))
        if p.summary:
            lines.append(f"    summary: {p.summary}")
        if p.key_claims:
            lines.append("    key claims:")
            for claim in p.key_claims:
                lines.append(f"      - {claim}")
    lines.append("")
    return "\n".join(lines)


def format_evidence_usage_instructions() -> str:
    """Standard instructions for evidence-aware reasoning."""
    return (
        "\nEvidence reasoning rules:\n"
        "- Cite evidence inline using its label, e.g. [E1].\n"
        "- Challenge evidence quality when it is weak, narrow, or outdated.\n"
        "- Distinguish supported claims (cite the evidence) from your own assumptions.\n"
        "- If a claim has no supporting evidence in the AVAILABLE EVIDENCE block,\n"
        "  flag it explicitly as an assumption rather than a fact.\n"
        "- Different agents may interpret the SAME evidence differently — that is\n"
        "  legitimate disagreement and must be argued, not avoided.\n"
    )
