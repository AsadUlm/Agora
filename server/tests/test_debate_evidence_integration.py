"""
Debate ↔ RAG evidence integration tests.

These tests verify that the stabilized retrieval pipeline is actually
wired into the debate flow:

  * ``RetrievalService.retrieve_for_agent`` honors ``knowledge_mode`` and
    ``assigned_document_ids`` correctly (no DB needed when short-circuiting).
  * ``RoundManager._retrieve_for_agent`` forwards the agent's knowledge
    config and a role-aware strategy into ``RetrievalService``.
  * Prompt builders inject the ``AVAILABLE EVIDENCE`` block and the
    ``[E#]`` citation labels when evidence packets are supplied.
  * ``RoundManager._build_retrieval_summary`` exposes evidence labels per
    document so the UI can show which sources backed which citations.

No external LLM, no real pgvector. All heavy collaborators are mocked.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.contracts import AgentContext, RetrievedChunk, TurnContext
from app.services.debate_engine.prompts.round1_prompts import (
    build_opening_statement_prompt,
)
from app.services.debate_engine.round_manager import RoundManager
from app.services.retrieval.evidence import EvidencePacket
from app.services.retrieval.retrieval_service import RetrievalService


# ── Helpers ──────────────────────────────────────────────────────────────────


def _agent_ctx(
    knowledge_mode: str = "shared_session_docs",
    assigned: list[uuid.UUID] | None = None,
    role: str = "Analyst",
) -> AgentContext:
    return AgentContext(
        agent_id=uuid.uuid4(),
        role=role,
        provider="mock",
        model="mock-model",
        temperature=0.5,
        knowledge_mode=knowledge_mode,
        knowledge_strict=False,
        assigned_document_ids=assigned or [],
    )


def _turn_ctx(agents: list[AgentContext]) -> TurnContext:
    return TurnContext(
        turn_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        question="What deployment region does the document recommend?",
        agents=agents,
        turn_index=1,
    )


def _packet(label: str, doc_id: uuid.UUID | None = None) -> EvidencePacket:
    return EvidencePacket(
        id=f"doc-{doc_id or uuid.uuid4()}",
        citation_label=label,
        document_id=doc_id or uuid.uuid4(),
        source_title="orion-spec.pdf",
        source_type="User-uploaded document",
        relevance_score=0.82,
        summary="The project codename is ORION-742 and the recommended deployment region is asia-northeast3.",
        key_claims=["Recommended deployment region: asia-northeast3."],
        reliability="MODERATE_CONFIDENCE",
    )


# ── RetrievalService.retrieve_for_agent short-circuits ──────────────────────


class TestRetrievalServiceModeRouting:
    """``retrieve_for_agent`` must respect ``knowledge_mode`` *before* touching DB."""

    @pytest.mark.asyncio
    async def test_no_docs_mode_skips_db_entirely(self):
        svc = RetrievalService()
        # Sentinel DB — if the code path touches it, we get an AttributeError.
        sentinel_db = object()
        out = await svc.retrieve_for_agent(
            agent_id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            query="anything",
            db=sentinel_db,  # type: ignore[arg-type]
            knowledge_mode="no_docs",
        )
        assert out == []

    @pytest.mark.asyncio
    async def test_assigned_docs_only_with_empty_list_skips_db(self):
        svc = RetrievalService()
        sentinel_db = object()
        out = await svc.retrieve_for_agent(
            agent_id=uuid.uuid4(),
            session_id=uuid.uuid4(),
            query="anything",
            db=sentinel_db,  # type: ignore[arg-type]
            knowledge_mode="assigned_docs_only",
            assigned_document_ids=[],
        )
        assert out == []


# ── RoundManager._retrieve_for_agent forwards to RetrievalService ───────────


class TestRoundManagerRetrievalWiring:
    @pytest.mark.asyncio
    async def test_retrieve_for_agent_forwards_knowledge_config(self):
        rm = RoundManager.__new__(RoundManager)
        rm._retrieval = MagicMock()
        rm._retrieval.retrieve_for_agent = AsyncMock(return_value=[])

        doc_id = uuid.uuid4()
        agent = _agent_ctx(
            knowledge_mode="assigned_docs_only",
            assigned=[doc_id],
            role="Analyst",
        )
        ctx = _turn_ctx([agent])

        result = await rm._retrieve_for_agent(
            db=MagicMock(),
            ctx=ctx,
            agent_ctx=agent,
            cycle_number=1,
            evidence_memory_view=None,
        )

        assert result == []
        rm._retrieval.retrieve_for_agent.assert_awaited_once()
        kwargs = rm._retrieval.retrieve_for_agent.call_args.kwargs
        assert kwargs["agent_id"] == agent.agent_id
        assert kwargs["session_id"] == ctx.session_id
        assert kwargs["query"] == ctx.question
        assert kwargs["knowledge_mode"] == "assigned_docs_only"
        assert kwargs["assigned_document_ids"] == [doc_id]
        assert kwargs["top_k"] == 3
        # A role-aware strategy must be passed (Step 31).
        assert kwargs["strategy"] is not None


# ── Prompt-level evidence injection ─────────────────────────────────────────


class TestPromptEvidenceInjection:
    def test_evidence_block_present_when_packets_supplied(self):
        prompt = build_opening_statement_prompt(
            role="Analyst",
            question="What deployment region does the document recommend?",
            retrieved_chunks=[],
            evidence_packets=[_packet("E1")],
        )
        assert "AVAILABLE EVIDENCE" in prompt
        assert "[E1]" in prompt
        # Strengthened evidence-mode instructions must reach the agent.
        assert "Cite by [E#]" in prompt
        assert "Do NOT ignore the supplied evidence" in prompt

    def test_evidence_block_absent_when_no_packets_no_chunks(self):
        prompt = build_opening_statement_prompt(
            role="Analyst",
            question="What deployment region does the document recommend?",
            retrieved_chunks=[],
            evidence_packets=[],
        )
        assert "AVAILABLE EVIDENCE" not in prompt
        # Reasoning-only block must instruct against inventing citations.
        assert "reasoning-only" in prompt

    def test_legacy_raw_chunks_still_render(self):
        # Backward compatibility: when only raw chunks are supplied (no packets)
        # the legacy "Relevant document context" block is used.
        prompt = build_opening_statement_prompt(
            role="Analyst",
            question="q?",
            retrieved_chunks=[
                {"content": "asia-northeast3 is the recommended region.", "similarity_score": 0.8}
            ],
            evidence_packets=None,
        )
        assert "Relevant document context" in prompt
        assert "asia-northeast3" in prompt


# ── Retrieval summary → WS payload ──────────────────────────────────────────


class TestBuildRetrievalSummary:
    @pytest.mark.asyncio
    async def test_summary_includes_evidence_labels_per_document(self):
        rm = RoundManager.__new__(RoundManager)
        doc_id = uuid.uuid4()
        chunks = [
            RetrievedChunk(
                chunk_id=uuid.uuid4(),
                document_id=doc_id,
                chunk_index=0,
                content="asia-northeast3 is the recommended deployment region.",
                similarity_score=0.81,
            )
        ]
        packets = [_packet("E1", doc_id=doc_id)]

        # Stub db.execute to return a single (id, filename) row.
        db = MagicMock()
        result_proxy = MagicMock()
        result_proxy.all.return_value = [(doc_id, "orion-spec.pdf")]
        db.execute = AsyncMock(return_value=result_proxy)

        summary = await rm._build_retrieval_summary(db, chunks, packets=packets)

        assert summary is not None
        assert summary["total_chunks"] == 1
        assert summary["evidence_labels"] == ["E1"]
        assert len(summary["documents"]) == 1
        doc_block = summary["documents"][0]
        assert doc_block["document_id"] == str(doc_id)
        assert doc_block["document_name"] == "orion-spec.pdf"
        assert doc_block["evidence_labels"] == ["E1"]

    @pytest.mark.asyncio
    async def test_summary_empty_when_no_chunks(self):
        rm = RoundManager.__new__(RoundManager)
        summary = await rm._build_retrieval_summary(MagicMock(), [])
        assert summary is None
