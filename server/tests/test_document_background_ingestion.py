"""
Step 45 — Background document ingestion tests.

These tests cover the split between the synchronous *create_pending* phase
(runs inside the HTTP request) and the *process_in_background* phase
(runs after the response is sent, on its own DB session).

We exercise the service directly rather than the HTTP layer so we can
deterministically observe each phase without depending on FastAPI's
BackgroundTasks scheduler.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

from app.models.chat_session import ChatSession
from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.models.user import User
from app.services.documents.ingestion_service import (
    DocumentIngestionError,
    DocumentIngestionService,
)
from app.services.embeddings.embedding_service import MockEmbeddingService
from app.services.storage.base import DocumentStorageService, StoredFile


# ── helpers ──────────────────────────────────────────────────────────────────


class _InMemoryStorage(DocumentStorageService):
    """Minimal in-memory storage backend (mirrors the one in test_rag_pipeline)."""

    provider_name = "local"

    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def upload_bytes(self, *, content, document_id, session_id, filename, content_type=None):
        key = f"mem://{document_id}"
        self.blobs[key] = content
        return StoredFile(
            storage_provider="local",
            original_filename=filename,
            local_path=key,
            bytes=len(content),
            content_type=content_type,
            format=filename.rsplit(".", 1)[-1].lower(),
            resource_type="raw",
        )

    async def download_bytes(self, stored):
        return self.blobs[stored.local_path]

    async def delete(self, stored):
        self.deleted.append(stored.local_path)
        self.blobs.pop(stored.local_path, None)


async def _make_session(db, session_id: uuid.UUID) -> None:
    user = User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        email="bg@example.com",
        password_hash="x",
        name="Bg",
    )
    db.add(user)
    await db.flush()
    db.add(ChatSession(id=session_id, user_id=user.id, title="Bg test"))
    await db.flush()


def _chunk_count(db_sync_session, document_id):
    """Synchronous-style count using the async session via execute."""
    return db_sync_session.execute(
        select(func.count()).select_from(DocumentChunk).where(
            DocumentChunk.document_id == document_id
        )
    )


# ─────────────────────────────────────────────────────────────────────────────
# A. create_pending returns a processing row, no chunks yet
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pending_returns_processing_with_no_chunks(db_session):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    storage = _InMemoryStorage()
    svc = DocumentIngestionService(storage=storage)

    doc = await svc.create_pending(
        db=db_session,
        session_id=session_id,
        filename="hello.txt",
        file_bytes=b"hello world " * 40,
    )

    assert doc.id is not None
    assert doc.status == DocumentStatus.processing
    assert doc.storage_provider == "local"
    # The blob should be in storage already.
    assert f"mem://{doc.id}" in storage.blobs
    # But no chunks yet — that's the background phase's job.
    result = await db_session.execute(
        select(func.count()).select_from(DocumentChunk).where(
            DocumentChunk.document_id == doc.id
        )
    )
    assert result.scalar() == 0


# ─────────────────────────────────────────────────────────────────────────────
# B. process_in_background completes the pipeline → status=ready, chunks exist
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_in_background_marks_ready_and_creates_chunks(
    db_session, _test_session_factory,
):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    storage = _InMemoryStorage()
    svc = DocumentIngestionService(storage=storage)

    content = ("Climate policy is an important topic. " * 40 + "\n\n") * 3
    doc = await svc.create_pending(
        db=db_session,
        session_id=session_id,
        filename="policy.txt",
        file_bytes=content.encode("utf-8"),
    )
    await db_session.commit()
    document_id = doc.id

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=MockEmbeddingService(),
    ):
        await svc.process_in_background(_test_session_factory, document_id)

    # Reload from a fresh session to confirm persistence.
    async with _test_session_factory() as fresh:
        reloaded = await fresh.get(Document, document_id)
        assert reloaded.status == DocumentStatus.ready
        result = await fresh.execute(
            select(func.count()).select_from(DocumentChunk).where(
                DocumentChunk.document_id == document_id
            )
        )
        assert result.scalar() >= 1


# ─────────────────────────────────────────────────────────────────────────────
# C. Embedding failure → document still READY (chunks stored), embedding_status
#    = failed. Embeddings are decoupled from readiness — a broken provider must
#    never fail the document or leave it processing forever.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_in_background_embedding_error_still_ready(
    db_session, _test_session_factory,
):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    storage = _InMemoryStorage()
    svc = DocumentIngestionService(storage=storage)

    doc = await svc.create_pending(
        db=db_session,
        session_id=session_id,
        filename="boom.txt",
        file_bytes=b"some readable text here. " * 50,
    )
    await db_session.commit()
    document_id = doc.id

    class _BrokenEmbeddings:
        async def embed_batch(self, texts):  # noqa: D401, ANN001
            raise RuntimeError("embeddings service unavailable")

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=_BrokenEmbeddings(),
    ):
        # Must not raise even though embeddings blew up.
        await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        reloaded = await fresh.get(Document, document_id)
        # READY despite the embedding failure — retrieval will use keyword fallback.
        assert reloaded.status == DocumentStatus.ready
        assert reloaded.embedding_status == "failed"
        # Chunks ARE stored (plain text) so the document is retrievable.
        result = await fresh.execute(
            select(func.count()).select_from(DocumentChunk).where(
                DocumentChunk.document_id == document_id
            )
        )
        assert result.scalar() >= 1


# ─────────────────────────────────────────────────────────────────────────────
# D. Document deleted before background task runs → exits cleanly, no raise
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_in_background_handles_deleted_document(
    db_session, _test_session_factory,
):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    storage = _InMemoryStorage()
    svc = DocumentIngestionService(storage=storage)

    doc = await svc.create_pending(
        db=db_session,
        session_id=session_id,
        filename="gone.txt",
        file_bytes=b"hello " * 50,
    )
    await db_session.commit()
    document_id = doc.id

    # Simulate the user deleting the document before the task fires.
    async with _test_session_factory() as fresh:
        await fresh.delete(await fresh.get(Document, document_id))
        await fresh.commit()

    # Must complete silently — no exception, no DB writes.
    await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        assert await fresh.get(Document, document_id) is None


# ─────────────────────────────────────────────────────────────────────────────
# E. Idempotency — calling background task twice does not duplicate chunks
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_in_background_is_idempotent_on_retry(
    db_session, _test_session_factory,
):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    storage = _InMemoryStorage()
    svc = DocumentIngestionService(storage=storage)

    content = ("Renewable energy and policy. " * 40 + "\n\n") * 3
    doc = await svc.create_pending(
        db=db_session,
        session_id=session_id,
        filename="policy.txt",
        file_bytes=content.encode("utf-8"),
    )
    await db_session.commit()
    document_id = doc.id

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=MockEmbeddingService(),
    ):
        await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        result = await fresh.execute(
            select(func.count()).select_from(DocumentChunk).where(
                DocumentChunk.document_id == document_id
            )
        )
        first_count = result.scalar()
        # Reset the status so the second call actually re-runs work, to
        # prove that even if it does run, it wipes the previous chunks
        # before inserting (no duplicates).
        reloaded = await fresh.get(Document, document_id)
        reloaded.status = DocumentStatus.processing
        await fresh.commit()

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=MockEmbeddingService(),
    ):
        await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        result = await fresh.execute(
            select(func.count()).select_from(DocumentChunk).where(
                DocumentChunk.document_id == document_id
            )
        )
        second_count = result.scalar()

    assert first_count >= 1
    assert second_count == first_count  # no duplicates accumulated


# ─────────────────────────────────────────────────────────────────────────────
# F. Unsupported file type is rejected in the synchronous phase (4xx-ready)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pending_rejects_unsupported_type(db_session):
    session_id = uuid.UUID("00000000-0000-0000-0000-000000000099")
    await _make_session(db_session, session_id)

    svc = DocumentIngestionService(storage=_InMemoryStorage())
    with pytest.raises(DocumentIngestionError, match="Unsupported file type"):
        await svc.create_pending(
            db=db_session,
            session_id=session_id,
            filename="malware.exe",
            file_bytes=b"MZ\x90\x00",
        )
