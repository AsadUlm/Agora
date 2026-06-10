"""
RAG upload full-refactor tests.

Covers the new deterministic, synchronous, embedding-decoupled pipeline:

  * Markdown / text upload becomes ``ready`` synchronously (no polling).
  * Empty / unextractable content becomes ``failed`` with a visible message.
  * Unsupported extensions are rejected.
  * chunk_count > 0 for valid documents; chunks carry document_id + filename.
  * Embedding failure NEVER fails the document or leaves it processing — it
    becomes ``ready`` with embedding_status='failed' (keyword fallback path).
  * A processing exception is persisted as ``failed`` (never stuck processing).
  * Integration: upload 4 markdown files → all ready; list summary ready=4,
    processing=0; retrieval returns chunks for a relevant query via keyword
    fallback (mock embeddings produce all-zero vectors in tests).
"""

from __future__ import annotations

import uuid
from io import BytesIO
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat_session import ChatSession
from app.models.document import Document, DocumentStatus
from app.models.document_chunk import DocumentChunk
from app.models.user import User
from app.services.documents.ingestion_service import DocumentIngestionService
from app.services.embeddings import embedding_service as embedding_factory
from app.services.retrieval.retrieval_service import RetrievalService
from app.services.storage.base import DocumentStorageService, StoredFile


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _force_local_storage(tmp_path, monkeypatch):
    """Force local-disk storage into a temp dir so API-level upload tests are
    hermetic (never touch Cloudinary / the network), regardless of the ambient
    .env DOCUMENT_STORAGE_PROVIDER."""
    monkeypatch.setattr("app.core.config.settings.DOCUMENT_STORAGE_PROVIDER", "local")
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()
    yield
    fac.reset_storage_cache()


# ── helpers ──────────────────────────────────────────────────────────────────

MARKDOWN_FILES = {
    "00_source_notes.md": (
        "# Source Notes\n\n"
        "These notes compare universities for undergraduate Software Engineering.\n"
        "Both Ajou University and Inha University are located in the Incheon / "
        "Suwon area of South Korea.\n"
    ),
    "01_university_profiles.md": (
        "# University Profiles\n\n"
        "## Ajou University\n"
        "Ajou University has a strong Software Engineering program with industry ties.\n\n"
        "## Inha University\n"
        "Inha University offers a competitive Computer Engineering and Software track.\n"
    ),
    "02_comparison_matrix.md": (
        "# Comparison Matrix\n\n"
        "Criteria: reputation, faculty, employment.\n"
        "Ajou University scores high on software industry partnerships.\n"
        "Inha University scores high on research output.\n"
    ),
    "03_decision_scenarios.md": (
        "# Decision Scenarios\n\n"
        "If you prioritise software engineering internships, Ajou University is better.\n"
        "If you prioritise research, Inha University may be the better choice.\n"
    ),
}


class _InMemoryStorage(DocumentStorageService):
    provider_name = "local"

    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

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
        self.blobs.pop(stored.local_path, None)


async def _seed_user_and_session(db: AsyncSession) -> ChatSession:
    user = User(id=uuid.uuid4(), email=f"u-{uuid.uuid4()}@example.com", password_hash="x")
    db.add(user)
    await db.flush()
    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="rag-refactor")
    db.add(session)
    await db.flush()
    return session


async def _api_create_session(client: AsyncClient) -> str:
    resp = await client.post("/sessions", json={"title": "rag refactor"})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _md_files(*names: str):
    return [
        ("files", (name, BytesIO(MARKDOWN_FILES[name].encode("utf-8")), "text/markdown"))
        for name in names
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Synchronous upload → terminal status (no polling needed)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_markdown_upload_becomes_ready_with_chunks(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("01_university_profiles.md",
                         BytesIO(MARKDOWN_FILES["01_university_profiles.md"].encode("utf-8")),
                         "text/markdown")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # Status is terminal immediately — never 'processing'.
    assert body["status"] == "ready"
    assert body["chunk_count"] >= 1
    assert body["source_type"] == "md"
    # Mock embeddings (zero vectors) ⇒ embeddings 'disabled', doc still ready.
    assert body["embedding_status"] in ("ready", "disabled")
    assert body["error_message"] is None
    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_markdown_with_weird_mime_still_ready(client: AsyncClient, tmp_path, monkeypatch):
    """Markdown sent as application/octet-stream (the common browser case) must
    not be rejected on MIME — extension drives acceptance."""
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("notes.md", BytesIO(b"# Heading\n\nReal markdown body here. " * 10),
                        "application/octet-stream")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "ready"
    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_txt_upload_becomes_ready(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("note.txt", BytesIO(b"Plain text content about engineering. " * 20),
                        "text/plain")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "ready"
    assert resp.json()["chunk_count"] >= 1
    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_empty_markdown_becomes_failed(client: AsyncClient, tmp_path, monkeypatch):
    """Whitespace-only markdown has non-zero bytes but no extractable text →
    the document is persisted as ``failed`` with a message (never processing)."""
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("blank.md", BytesIO(b"   \n\n   \t  \n"), "text/markdown")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error_message"]
    assert body["chunk_count"] == 0
    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_unsupported_extension_rejected(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("malware.exe", BytesIO(b"MZ\x90\x00binary"), "application/octet-stream")},
    )
    assert resp.status_code == 415


# ─────────────────────────────────────────────────────────────────────────────
# Chunk metadata: document_id + filename resolvable for every chunk
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chunks_carry_document_id_and_filename(db_session: AsyncSession):
    session = await _seed_user_and_session(db_session)
    svc = DocumentIngestionService(storage=_InMemoryStorage())

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=embedding_factory.MockEmbeddingService(),
    ):
        doc = await svc.process_upload(
            db=db_session,
            session_id=session.id,
            filename="01_university_profiles.md",
            file_bytes=MARKDOWN_FILES["01_university_profiles.md"].encode("utf-8"),
        )
    assert doc.status == DocumentStatus.ready

    rows = (
        await db_session.execute(
            select(DocumentChunk).where(DocumentChunk.document_id == doc.id)
        )
    ).scalars().all()
    assert len(rows) >= 1
    for row in rows:
        assert row.document_id == doc.id           # documentId metadata
        assert isinstance(row.chunk_index, int)    # chunkIndex metadata
        assert row.content and row.content.strip()
    # filename resolves from the parent Document row (source metadata for UI).
    assert doc.filename == "01_university_profiles.md"


# ─────────────────────────────────────────────────────────────────────────────
# Embedding failure / processing exception never leave the doc processing
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_embedding_failure_keeps_document_ready(db_session: AsyncSession):
    session = await _seed_user_and_session(db_session)
    svc = DocumentIngestionService(storage=_InMemoryStorage())

    class _BrokenEmbeddings:
        async def embed_batch(self, texts):
            raise RuntimeError("provider 500")

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=_BrokenEmbeddings(),
    ):
        doc = await svc.process_upload(
            db=db_session,
            session_id=session.id,
            filename="notes.md",
            file_bytes=b"# Title\n\nSubstantial markdown content for chunking. " * 20,
        )
    assert doc.status == DocumentStatus.ready
    assert doc.embedding_status == "failed"
    count = (
        await db_session.execute(
            select(func.count(DocumentChunk.id)).where(DocumentChunk.document_id == doc.id)
        )
    ).scalar()
    assert count and count > 0


@pytest.mark.asyncio
async def test_processing_exception_persists_failed(db_session: AsyncSession):
    """An unexpected exception inside the pipeline is caught and persisted as
    ``failed`` — the document is never left in ``processing``."""
    session = await _seed_user_and_session(db_session)
    svc = DocumentIngestionService(storage=_InMemoryStorage())

    with patch(
        "app.services.documents.ingestion_service.extract_text",
        side_effect=ValueError("boom in extractor"),
    ):
        doc = await svc.process_upload(
            db=db_session,
            session_id=session.id,
            filename="weird.md",
            file_bytes=b"# Something\n\nbody " * 10,
        )
    assert doc.status == DocumentStatus.failed
    assert doc.error_message
    assert doc.processed_at is not None


# ─────────────────────────────────────────────────────────────────────────────
# Integration: 4 markdown files → all ready; list ready=4 processing=0
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_four_markdown_files_all_ready(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload-batch?session_id={session_id}",
        files=_md_files(*MARKDOWN_FILES.keys()),
    )
    assert resp.status_code == 207, resp.text
    body = resp.json()
    assert body["failed"] == []
    assert len(body["uploaded"]) == 4
    assert all(d["status"] == "ready" for d in body["uploaded"])
    assert all(d["chunk_count"] >= 1 for d in body["uploaded"])

    # List endpoint reflects the same terminal state: 4 ready, 0 processing.
    list_resp = await client.get(f"/documents?session_id={session_id}")
    assert list_resp.status_code == 200
    items = list_resp.json()
    ready = sum(1 for i in items if i["status"] == "ready")
    processing = sum(1 for i in items if i["status"] in ("processing", "uploaded", "uploading"))
    assert ready == 4
    assert processing == 0
    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_retrieval_returns_chunks_via_keyword_fallback(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch,
):
    """End-to-end: upload markdown via the API (mock embeddings ⇒ no usable
    vectors), then retrieval still returns relevant chunks through the keyword
    fallback path, with resolvable source document ids."""
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _api_create_session(client)
    resp = await client.post(
        f"/documents/upload-batch?session_id={session_id}",
        files=_md_files(*MARKDOWN_FILES.keys()),
    )
    assert resp.status_code == 207
    assert all(d["status"] == "ready" for d in resp.json()["uploaded"])

    # Ensure retrieval uses the (mock) embedding service so the vector path is
    # cleanly unavailable and the keyword fallback engages.
    embedding_factory.set_embedding_service(embedding_factory.MockEmbeddingService())

    svc = RetrievalService()
    chunks = await svc.retrieve(
        query="For Software Engineering which is better Ajou University or Inha University",
        session_id=uuid.UUID(session_id),
        db=db_session,
        top_k=5,
    )
    assert chunks, "keyword fallback should return chunks for a relevant query"
    # Every chunk resolves to a real source document in this session.
    doc_ids = {c.document_id for c in chunks}
    rows = (
        await db_session.execute(
            select(Document.id, Document.filename)
            .where(Document.id.in_(doc_ids))
            .where(Document.chat_session_id == uuid.UUID(session_id))
        )
    ).all()
    assert len(rows) == len(doc_ids)
    # The matched text actually mentions the queried universities.
    joined = " ".join(c.content for c in chunks).lower()
    assert "ajou" in joined or "inha" in joined
    fac.reset_storage_cache()
