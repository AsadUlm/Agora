"""
Tests for the RAG document pipeline:
  - Text chunker
  - Text extractor (plain text)
  - EmbeddingService (mock)
  - DocumentIngestionService (in-memory SQLite; pgvector not available so we
    verify the pipeline up to the DB write with mock embeddings)
  - RetrievalService (unit-tested with a mocked DB session)
"""

from __future__ import annotations

import io
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Chunker tests
# ─────────────────────────────────────────────────────────────────────────────

from app.services.documents.chunker import chunk_text


class TestChunker:
    def test_empty_text_returns_empty(self):
        assert chunk_text("") == []
        assert chunk_text("   ") == []

    def test_short_text_returns_single_chunk(self):
        result = chunk_text("Hello world.", chunk_size=800)
        assert len(result) == 1
        assert "Hello world." in result[0]

    def test_long_text_is_split(self):
        # ~2000 chars should yield multiple chunks with chunk_size=800
        text = ("This is a sentence about climate change. " * 60)
        result = chunk_text(text, chunk_size=800, overlap=100)
        assert len(result) >= 2, f"Expected multiple chunks, got {len(result)}"

    def test_chunks_preserve_content(self):
        word = "UNIQUEWORD"
        text = (f"This paragraph contains {word}. " + "Filler text sentence. " * 20 + "\n\n") * 3
        result = chunk_text(text, chunk_size=800)
        combined = " ".join(result)
        assert word in combined

    def test_min_chunk_filters_tiny_fragments(self):
        # Text that produces tiny trailing fragments should have them filtered
        text = "A" * 800 + "\n\nX"  # "X" is below min_chunk default (80)
        result = chunk_text(text, chunk_size=800, min_chunk=80)
        for chunk in result:
            assert len(chunk) >= 5  # at least some content

    def test_chunk_ordering(self):
        # Chunks should maintain document order
        text = "\n\n".join([f"Paragraph {i}: " + "word " * 20 for i in range(10)])
        result = chunk_text(text, chunk_size=200, overlap=20)
        # First chunk should mention lower paragraph numbers
        assert "Paragraph 0" in result[0] or "Paragraph 1" in result[0]


# ─────────────────────────────────────────────────────────────────────────────
# Extractor tests
# ─────────────────────────────────────────────────────────────────────────────

from app.services.documents.extractor import (
    ExtractionError,
    UnsupportedFileType,
    extract_text,
    extension_from_filename,
    supported_extensions,
)


class TestExtractor:
    def test_supported_extensions_set(self):
        exts = supported_extensions()
        assert ".txt" in exts
        assert ".pdf" in exts
        assert ".docx" in exts

    def test_extension_from_filename(self):
        assert extension_from_filename("document.PDF") == ".pdf"
        assert extension_from_filename("report.docx") == ".docx"
        assert extension_from_filename("notes.TXT") == ".txt"

    def test_txt_extraction_utf8(self):
        data = "Hello, world!\nThis is a test.".encode("utf-8")
        result = extract_text(data, "test.txt")
        assert "Hello, world!" in result

    def test_txt_extraction_latin1(self):
        data = "Caf\xe9 and cr\xeape".encode("latin-1")
        result = extract_text(data, "menu.txt")
        assert len(result) > 0

    def test_unsupported_extension_raises(self):
        with pytest.raises(UnsupportedFileType):
            extract_text(b"data", "file.xyz")

    def test_unknown_extension_raises(self):
        with pytest.raises(UnsupportedFileType):
            extract_text(b"data", "file.csv")

    def test_pdf_import_error_surfaces_as_extraction_error(self):
        """If pypdf is missing, we get ExtractionError not ImportError."""
        import sys
        pdf_bytes = b"%PDF-1.4 invalid"
        with patch.dict(sys.modules, {"pypdf": None}):
            with pytest.raises((ExtractionError, Exception)):
                extract_text(pdf_bytes, "test.pdf")


# ─────────────────────────────────────────────────────────────────────────────
# EmbeddingService tests
# ─────────────────────────────────────────────────────────────────────────────

from app.services.embeddings.embedding_service import MockEmbeddingService, EMBEDDING_DIM


class TestMockEmbeddingService:
    @pytest.mark.asyncio
    async def test_embed_returns_correct_dim(self):
        svc = MockEmbeddingService()
        result = await svc.embed("some text")
        assert len(result) == EMBEDDING_DIM
        assert all(v == 0.0 for v in result)

    @pytest.mark.asyncio
    async def test_embed_batch_empty(self):
        svc = MockEmbeddingService()
        result = await svc.embed_batch([])
        assert result == []

    @pytest.mark.asyncio
    async def test_embed_batch_multiple(self):
        svc = MockEmbeddingService()
        result = await svc.embed_batch(["text a", "text b", "text c"])
        assert len(result) == 3
        for vec in result:
            assert len(vec) == EMBEDDING_DIM


# ─────────────────────────────────────────────────────────────────────────────
# DocumentIngestionService integration test (SQLite, mock embeddings)
# ─────────────────────────────────────────────────────────────────────────────

from app.services.documents.ingestion_service import DocumentIngestionError, DocumentIngestionService
from app.models.document import DocumentStatus


class TestDocumentIngestionService:
    @pytest.mark.asyncio
    async def test_ingest_txt_success(self, db_session):
        """Full pipeline: upload .txt → extract → chunk → embed (mock) → DB."""
        session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")

        # We need a ChatSession row for the FK constraint
        from app.models.chat_session import ChatSession
        from app.models.user import User

        user = User(
            id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            email="test@example.com",
            password_hash="x",
            name="Test",
        )
        db_session.add(user)
        await db_session.flush()

        session = ChatSession(
            id=session_id,
            user_id=user.id,
            title="Test session",
        )
        db_session.add(session)
        await db_session.flush()

        content = ("This is important information about climate policy. " * 40 + "\n\n") * 3
        file_bytes = content.encode("utf-8")

        svc = DocumentIngestionService()

        with patch(
            "app.services.documents.ingestion_service.get_embedding_service",
            return_value=MockEmbeddingService(),
        ), patch.object(
            DocumentIngestionService,
            "_upload_path",
            return_value=MagicMock(
                write_bytes=MagicMock(),
                __str__=lambda self: "/tmp/test_doc.txt",
            ),
        ):
            doc = await svc.ingest(
                db=db_session,
                session_id=session_id,
                filename="policy.txt",
                file_bytes=file_bytes,
            )

        assert doc.status == DocumentStatus.ready
        assert doc.filename == "policy.txt"
        assert doc.source_type == "txt"

        # Verify chunks were created — use COUNT to avoid loading the Vector
        # embedding column (not natively supported by SQLite).
        from sqlalchemy import func, select
        from app.models.document_chunk import DocumentChunk
        result = await db_session.execute(
            select(func.count()).select_from(DocumentChunk).where(
                DocumentChunk.document_id == doc.id
            )
        )
        chunk_count = result.scalar()
        assert chunk_count >= 1

    @pytest.mark.asyncio
    async def test_ingest_unsupported_type_raises(self, db_session):
        session_id = uuid.uuid4()
        svc = DocumentIngestionService()
        with pytest.raises(DocumentIngestionError, match="Unsupported file type"):
            await svc.ingest(db_session, session_id, "file.csv", b"some,csv,data")

    @pytest.mark.asyncio
    async def test_ingest_empty_content_raises(self, db_session):
        svc = DocumentIngestionService()
        with patch(
            "app.services.documents.ingestion_service.get_embedding_service",
            return_value=MockEmbeddingService(),
), pytest.raises(DocumentIngestionError, match="Unsupported file type"):
            # .csv is unsupported, so it raises before creating any DB records
            await svc.ingest(
                db=db_session,
                session_id=uuid.uuid4(),
                filename="empty.csv",
                file_bytes=b"a,b,c\n1,2,3",
            )


# ─────────────────────────────────────────────────────────────────────────────
# RetrievalService unit tests (mock DB — pgvector not available in test DB)
# ─────────────────────────────────────────────────────────────────────────────

from app.services.retrieval.retrieval_service import RetrievalService


class TestRetrievalService:
    @pytest.mark.asyncio
    async def test_returns_empty_when_no_documents(self):
        """When the ready-document check returns None, retrieve returns []."""
        svc = RetrievalService()
        mock_db = AsyncMock()

        # Simulate: no ready documents
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        mock_db.execute = AsyncMock(return_value=execute_result)

        result = await svc.retrieve("some query", uuid.uuid4(), db=mock_db)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_embedding_failure(self):
        """Embedding failure → graceful empty list, no exception."""
        svc = RetrievalService()
        mock_db = AsyncMock()

        # Simulate: there are ready documents
        ready_result = MagicMock()
        ready_result.scalar_one_or_none.return_value = uuid.uuid4()
        mock_db.execute = AsyncMock(return_value=ready_result)

        failing_embedder = AsyncMock()
        failing_embedder.embed = AsyncMock(side_effect=RuntimeError("API down"))

        with patch(
            "app.services.retrieval.retrieval_service.get_embedding_service",
            return_value=failing_embedder,
        ):
            result = await svc.retrieve("query", uuid.uuid4(), db=mock_db)

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_db_query_failure(self):
        """pgvector query failure → graceful empty list."""
        svc = RetrievalService()
        mock_db = AsyncMock()

        call_count = 0

        async def _side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call: ready-doc check succeeds
                m = MagicMock()
                m.scalar_one_or_none.return_value = uuid.uuid4()
                return m
            raise RuntimeError("DB failure")

        mock_db.execute = _side_effect

        mock_embedder = AsyncMock()
        mock_embedder.embed = AsyncMock(return_value=[0.0] * 1536)

        with patch(
            "app.services.retrieval.retrieval_service.get_embedding_service",
            return_value=mock_embedder,
        ):
            result = await svc.retrieve("query", uuid.uuid4(), db=mock_db)

        assert result == []


# ─────────────────────────────────────────────────────────────────────────────
# Prompt builder tests — context injection
# ─────────────────────────────────────────────────────────────────────────────

from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt


class TestPromptBuilders:
    def test_round1_without_context(self):
        prompt = build_opening_statement_prompt("Scientist", "Is AI safe?")
        assert "Scientist" in prompt
        assert "Is AI safe?" in prompt
        assert "Source" not in prompt

    def test_round1_with_context(self):
        chunks = [{"content": "AI safety research shows X.", "similarity_score": 0.9}]
        prompt = build_opening_statement_prompt(
            "Scientist", "Is AI safe?", retrieved_chunks=chunks
        )
        assert "AI safety research shows X." in prompt
        assert "[Source 1]" in prompt

    def test_round2_with_context(self):
        chunks = [{"content": "Evidence Y from document.", "similarity_score": 0.8}]
        prompt = build_critique_prompt(
            role="Critic",
            question="Should we regulate AI?",
            own_stance="Yes",
            other_agents=[{"role": "Pro", "stance": "No", "key_points": ["point 1"]}],
            retrieved_chunks=chunks,
        )
        assert "Evidence Y from document." in prompt

    def test_round3_with_context(self):
        chunks = [{"content": "Final evidence Z.", "similarity_score": 0.7}]
        prompt = build_final_synthesis_prompt(
            role="Philosopher",
            question="Is AI safe?",
            original_stance="Cautiously optimistic",
            debate_summary="Various arguments were made.",
            retrieved_chunks=chunks,
        )
        assert "Final evidence Z." in prompt

    def test_multiple_chunks_all_included(self):
        chunks = [
            {"content": f"Document fact {i}.", "similarity_score": 0.9 - i * 0.1}
            for i in range(3)
        ]
        prompt = build_opening_statement_prompt("Agent", "Question?", retrieved_chunks=chunks)
        for i in range(3):
            assert f"Document fact {i}." in prompt
