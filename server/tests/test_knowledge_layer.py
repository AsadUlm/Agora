"""Step 31 — Knowledge Intelligence Layer + retrieval router/diversity tests.

These tests are pure / unit-level: no DB, no real LLM. They validate the
augmentation primitives (sampling, dedupe, importance scoring, role
strategy selection, post-SQL diversity re-ranking, evidence packet
extensions, EvidenceMemory backward compatibility, knowledge extractor
fail-soft behavior).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

import pytest

from app.schemas.contracts import LLMRequest, LLMResponse, RetrievedChunk
from app.services.knowledge.extractor import (
    KnowledgeExtractionService,
    compress_chunks_for_extraction,
    deduplicate_claims,
    rank_claims_by_importance,
    score_claim_importance,
)
from app.services.knowledge.schemas import DOCUMENT_TYPES, KnowledgeMetadata
from app.services.llm.service import LLMService
from app.services.retrieval.diversity import apply_strategy
from app.services.retrieval.evidence import (
    CONFIDENCE_LIMITED,
    CONFIDENCE_SPECULATIVE,
    EvidencePacket,
    assign_confidence_labels,
    format_evidence_block,
)
from app.services.retrieval.router import (
    ANALYST_STRATEGY,
    CRITIC_STRATEGY,
    CREATIVE_STRATEGY,
    DEFAULT_STRATEGY,
    select_strategy,
)
from app.services.debate_engine.debate_memory import (
    DebateMemory,
    DebateSummary,
    EvidenceMemory,
)


# ── Compressed sampling ──────────────────────────────────────────────────────


class TestCompressedSampling:
    def test_empty_input_returns_empty(self):
        assert compress_chunks_for_extraction([]) == ""
        assert compress_chunks_for_extraction(["", "  ", "\n"]) == ""

    def test_short_doc_keeps_all_chunks(self):
        chunks = ["intro text alpha", "middle text beta", "end text gamma"]
        out = compress_chunks_for_extraction(chunks)
        assert "alpha" in out and "beta" in out and "gamma" in out

    def test_caps_total_chars(self):
        big = "x" * 5000
        out = compress_chunks_for_extraction([big, big, big, big, big])
        # Hard cap is ~3500 chars + small per-chunk header overhead.
        assert len(out) <= 4000

    def test_includes_head_and_tail(self):
        chunks = [f"chunk{i} content " * 5 for i in range(20)]
        out = compress_chunks_for_extraction(chunks)
        assert "chunk0 " in out  # head
        assert "chunk19 " in out  # tail


# ── Dedup + importance ──────────────────────────────────────────────────────


class TestDeduplicateClaims:
    def test_drops_near_duplicates(self):
        claims = [
            "The new policy reduces emissions by 30 percent annually.",
            "The new policy reduces emissions by 30% per year.",
            "Workers are required to undergo safety training.",
        ]
        out = deduplicate_claims(claims, similarity_threshold=0.5)
        assert len(out) == 2

    def test_filters_too_short_or_too_long(self):
        out = deduplicate_claims(["short", "x" * 500])
        assert out == []

    def test_keeps_distinct_claims(self):
        claims = [
            "Solar panels generate electricity from sunlight.",
            "Wind turbines harvest kinetic energy from air flow.",
        ]
        assert len(deduplicate_claims(claims)) == 2


class TestImportanceScoring:
    def test_higher_score_with_numbers_and_keywords(self):
        a = "The reform reduces costs by 25 percent and increases efficiency."
        b = "Some words here exist quietly and softly indeed."
        assert score_claim_importance(a) > score_claim_importance(b)

    def test_empty_claim_zero_score(self):
        assert score_claim_importance("") == 0.0
        assert score_claim_importance("   ") == 0.0

    def test_rank_returns_top_k(self):
        claims = [
            "Filler claim with no signal markers at all here.",
            "Major regulation reduces incidents by 40 percent annually.",
            "Another filler statement.",
        ]
        ranked = rank_claims_by_importance(claims, top_k=2)
        assert len(ranked) == 2
        assert ranked[0].startswith("Major regulation")


# ── Knowledge extractor (mock LLM) ───────────────────────────────────────────


class _SuccessfulMockLLM(LLMService):
    async def generate(self, request: LLMRequest) -> LLMResponse:
        payload = {
            "document_type": "policy_report",
            "summary": "A two-sentence summary of the document content.",
            "main_topics": ["education", "policy reform"],
            "key_claims": [
                "The new reform reduces dropout rates by 25 percent annually.",
                "Funding increases improve teacher retention significantly.",
            ],
            "key_entities": ["Department of Education"],
            "risk_domains": ["unintended consequences"],
        }
        return LLMResponse(content=json.dumps(payload), prompt_tokens=10, completion_tokens=50, latency_ms=1)


class _BrokenMockLLM(LLMService):
    async def generate(self, request: LLMRequest) -> LLMResponse:
        return LLMResponse(content="not a json at all", prompt_tokens=1, completion_tokens=1, latency_ms=1)


class _RaisingMockLLM(LLMService):
    async def generate(self, request: LLMRequest) -> LLMResponse:
        raise RuntimeError("upstream timeout")


class TestKnowledgeExtractor:
    @pytest.mark.asyncio
    async def test_success_path(self):
        svc = KnowledgeExtractionService(llm=_SuccessfulMockLLM())
        meta = await svc.extract(["intro paragraph " * 30, "body paragraph " * 30], filename="report.pdf", source_type="pdf")
        assert meta.extraction_status == "ok"
        assert meta.document_type == "policy_report"
        assert meta.document_type in DOCUMENT_TYPES
        assert len(meta.main_topics) >= 1
        assert len(meta.key_claims) >= 1

    @pytest.mark.asyncio
    async def test_empty_chunks_skipped(self):
        svc = KnowledgeExtractionService(llm=_SuccessfulMockLLM())
        meta = await svc.extract([], filename="x.pdf")
        assert meta.extraction_status == "skipped"
        assert meta.extraction_error == "empty_sample"

    @pytest.mark.asyncio
    async def test_parse_failure_failsoft(self):
        svc = KnowledgeExtractionService(llm=_BrokenMockLLM())
        meta = await svc.extract(["x" * 200], filename="x.pdf")
        assert meta.extraction_status == "failed"
        assert "parse" in (meta.extraction_error or "")

    @pytest.mark.asyncio
    async def test_llm_call_failure_failsoft(self):
        svc = KnowledgeExtractionService(llm=_RaisingMockLLM())
        meta = await svc.extract(["x" * 200], filename="x.pdf")
        assert meta.extraction_status == "failed"
        assert "llm_call" in (meta.extraction_error or "")

    def test_metadata_round_trip(self):
        meta = KnowledgeMetadata(
            document_type="policy_report",
            summary="s",
            main_topics=["a"],
            key_claims=["claim text long enough to pass filters please"],
            key_entities=["e"],
            risk_domains=["d"],
            extraction_status="ok",
            extraction_error=None,
        )
        data = meta.to_dict()
        restored = KnowledgeMetadata.from_dict(data)
        assert restored.document_type == "policy_report"
        assert restored.main_topics == ["a"]


# ── Retrieval router ─────────────────────────────────────────────────────────


class TestRetrievalRouter:
    def test_role_aliases(self):
        assert select_strategy("analyst").name == ANALYST_STRATEGY.name
        assert select_strategy("ANALYST").name == ANALYST_STRATEGY.name
        assert select_strategy("critic").name == CRITIC_STRATEGY.name
        assert select_strategy("creative").name == CREATIVE_STRATEGY.name
        assert select_strategy("moderator").name == ANALYST_STRATEGY.name

    def test_unknown_role_falls_back_to_default(self):
        assert select_strategy("totally-unknown").name == DEFAULT_STRATEGY.name

    def test_diversity_bumps_with_cycle(self):
        s1 = select_strategy("critic", cycle_number=1)
        s3 = select_strategy("critic", cycle_number=3)
        assert s3.diversity_weight > s1.diversity_weight
        assert s3.diversity_weight <= 0.95

    def test_contradictions_flag_flips_when_no_dispute(self):
        # Critic already prefers contradictions by default; verify analyst gets
        # the flag flipped on when there is established evidence but no dispute.
        evm = {"strongest_evidence": ["x"], "disputed_evidence": []}
        s = select_strategy("analyst", cycle_number=2, evidence_memory=evm)
        assert s.prefer_contradictions is True


# ── Diversity engine ─────────────────────────────────────────────────────────


def _chunk(doc_id: uuid.UUID, content: str, score: float, idx: int = 0) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid.uuid4(),
        document_id=doc_id,
        chunk_index=idx,
        content=content,
        similarity_score=score,
    )


class TestDiversityEngine:
    def test_source_balance_caps_per_document(self):
        d1, d2 = uuid.uuid4(), uuid.uuid4()
        chunks = [
            _chunk(d1, "alpha policy regulation framework", 0.9, 0),
            _chunk(d1, "alpha policy regulation framework two", 0.85, 1),
            _chunk(d1, "alpha policy regulation framework three", 0.8, 2),
            _chunk(d2, "beta different content here entirely", 0.75, 0),
        ]
        out = apply_strategy(chunks, ANALYST_STRATEGY, top_k=3)
        # ANALYST_STRATEGY caps max_per_document=2.
        per_doc: dict[uuid.UUID, int] = {}
        for c in out:
            per_doc[c.document_id] = per_doc.get(c.document_id, 0) + 1
        assert per_doc.get(d1, 0) <= 2

    def test_keyword_boost_pulls_role_relevant_chunks_forward(self):
        d1, d2 = uuid.uuid4(), uuid.uuid4()
        chunks = [
            _chunk(d1, "completely neutral content text here", 0.7, 0),
            _chunk(d2, "policy framework regulation requires audit reports", 0.65, 0),
        ]
        out = apply_strategy(chunks, ANALYST_STRATEGY, top_k=2)
        # The keyword-boosted analyst-relevant chunk should rank first.
        assert out[0].document_id == d2

    def test_returns_at_most_top_k(self):
        d = uuid.uuid4()
        chunks = [_chunk(d, f"text {i}", 0.6, i) for i in range(10)]
        out = apply_strategy(chunks, DEFAULT_STRATEGY, top_k=3)
        assert len(out) <= 3

    def test_empty_input_safe(self):
        assert apply_strategy([], DEFAULT_STRATEGY, top_k=3) == []


# ── Evidence packet extensions / confidence labels ───────────────────────────


def _packet(rel: float, claims: list[str], doc_id: uuid.UUID | None = None, topics: list[str] | None = None) -> EvidencePacket:
    return EvidencePacket(
        id=f"doc-{uuid.uuid4()}",
        citation_label="",
        document_id=doc_id or uuid.uuid4(),
        source_title="t",
        source_type="report",
        relevance_score=rel,
        summary="s",
        key_claims=claims,
        document_topics=topics or [],
    )


class TestConfidenceLabels:
    def test_low_relevance_marks_speculative(self):
        p = _packet(0.3, ["alpha beta"])
        assign_confidence_labels([p])
        assert p.confidence_label == CONFIDENCE_SPECULATIVE

    def test_single_packet_marks_limited_scope(self):
        p = _packet(0.8, ["alpha beta gamma delta"])
        assign_confidence_labels([p])
        assert p.confidence_label == CONFIDENCE_LIMITED

    def test_format_block_includes_confidence_and_type(self):
        p = _packet(0.8, ["alpha beta"])
        p.citation_label = "E1"
        p.document_type = "policy_report"
        p.document_topics = ["climate", "policy"]
        assign_confidence_labels([p])
        block = format_evidence_block([p])
        assert "confidence=" in block
        assert "type=policy_report" in block
        assert "topics=" in block


# ── Evidence memory backward compatibility ───────────────────────────────────


class TestEvidenceMemoryBackwardCompat:
    def test_default_init_has_new_fields_empty(self):
        em = EvidenceMemory()
        assert em.used_documents == []
        assert em.used_claims == []
        assert em.resolved_claims == []

    def test_to_dict_includes_new_keys(self):
        dm = DebateMemory(
            original_question="q",
            previous_synthesis="",
            debate_summary=DebateSummary(
                consensus="", main_conflict="",
                strongest_arguments=[], unresolved_questions=[]
            ),
            agent_states=[],
            disagreements=[],
            cycle_memories=[],
            followups_history=[],
        )
        d = dm.to_dict()
        em = d["evidence_memory"]
        assert "used_documents" in em
        assert "used_claims" in em
        assert "resolved_claims" in em
        # Original keys still present
        assert "strongest_evidence" in em
        assert "cited_sources" in em
