"""
Knowledge Intelligence Layer (Step 31).

Augments raw chunks with structured semantic metadata:
  - document_type   (classification used for retrieval routing)
  - document_summary
  - main_topics, key_claims, key_entities, risk_domains

Hooked into ingestion AFTER embedding succeeds. All failures are silently
absorbed — knowledge metadata is best-effort, never required for the rest of
the RAG pipeline to function.
"""

from app.services.knowledge.schemas import (
    DOCUMENT_TYPES,
    KnowledgeMetadata,
    empty_metadata,
)
from app.services.knowledge.extractor import (
    KnowledgeExtractionService,
    compress_chunks_for_extraction,
    deduplicate_claims,
    score_claim_importance,
)

__all__ = [
    "DOCUMENT_TYPES",
    "KnowledgeMetadata",
    "empty_metadata",
    "KnowledgeExtractionService",
    "compress_chunks_for_extraction",
    "deduplicate_claims",
    "score_claim_importance",
]
