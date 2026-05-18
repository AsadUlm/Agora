"""Knowledge Intelligence Layer — schemas (Step 31)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Coarse document classes used by the retrieval router. Kept open-set —
# unknown values are stored as "unknown" but never rejected, so the system
# tolerates new types from future extractor versions without code changes.
DOCUMENT_TYPES: tuple[str, ...] = (
    "policy_report",
    "academic_paper",
    "technical_specification",
    "legal_document",
    "research_summary",
    "news_article",
    "strategy_document",
    "internal_notes",
    "unknown",
)


@dataclass
class KnowledgeMetadata:
    """Structured semantic metadata produced for one document.

    All collections are bounded (the extractor truncates) so a single document
    cannot blow up the prompt budget downstream.
    """

    document_type: str = "unknown"
    summary: str = ""
    main_topics: list[str] = field(default_factory=list)
    key_claims: list[str] = field(default_factory=list)
    key_entities: list[str] = field(default_factory=list)
    risk_domains: list[str] = field(default_factory=list)
    # Diagnostics — never injected into prompts. Holds extractor outcome and
    # any error messages so we can debug without crashing the ingestion path.
    extraction_status: str = "skipped"  # "ok" | "skipped" | "failed"
    extraction_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_type": self.document_type,
            "summary": self.summary,
            "main_topics": list(self.main_topics),
            "key_claims": list(self.key_claims),
            "key_entities": list(self.key_entities),
            "risk_domains": list(self.risk_domains),
            "extraction_status": self.extraction_status,
            "extraction_error": self.extraction_error,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "KnowledgeMetadata":
        if not payload:
            return empty_metadata()
        return cls(
            document_type=str(payload.get("document_type") or "unknown"),
            summary=str(payload.get("summary") or ""),
            main_topics=_as_str_list(payload.get("main_topics")),
            key_claims=_as_str_list(payload.get("key_claims")),
            key_entities=_as_str_list(payload.get("key_entities")),
            risk_domains=_as_str_list(payload.get("risk_domains")),
            extraction_status=str(payload.get("extraction_status") or "ok"),
            extraction_error=payload.get("extraction_error"),
        )


def empty_metadata(
    *,
    status: str = "skipped",
    error: str | None = None,
) -> KnowledgeMetadata:
    return KnowledgeMetadata(extraction_status=status, extraction_error=error)


def _as_str_list(value: Any, *, max_items: int = 50) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if s:
            out.append(s)
        if len(out) >= max_items:
            break
    return out
