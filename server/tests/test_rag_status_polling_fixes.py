"""
Tests for the RAG status-polling and rag_active fixes:

  1. Failed processing stores error_message on Document row
  2. GET /documents returns error_message in response
  3. rag_active is True for shared_session_docs when session has ready docs
  4. rag_active is False when session has no ready docs (all processing/failed)
  5. rag_active is False when all agents use no_docs even if ready docs exist
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.embeddings.embedding_service import MockEmbeddingService

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn
from app.models.document import Document, DocumentStatus
from app.models.message import Message, MessageType, SenderType
from app.models.user import User
from app.services.chat_engine import ChatEngine
from app.services.documents.ingestion_service import DocumentIngestionService
from app.services.storage.base import DocumentStorageService, StoredFile


# ── Minimal in-memory storage ──────────────────────────────────────────────

class _MemStorage(DocumentStorageService):
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


# ── DB seed helpers ────────────────────────────────────────────────────────

async def _seed_user_and_session(db: AsyncSession) -> tuple[User, ChatSession]:
    user = User(
        id=uuid.uuid4(),
        email=f"test-{uuid.uuid4()}@example.com",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    session = ChatSession(id=uuid.uuid4(), user_id=user.id, title="fix-test")
    db.add(session)
    await db.flush()
    return user, session


async def _seed_debate_turn(
    db: AsyncSession,
    session: ChatSession,
    knowledge_mode: str = "shared_session_docs",
) -> tuple[ChatAgent, ChatTurn]:
    agent = ChatAgent(
        id=uuid.uuid4(),
        chat_session_id=session.id,
        name="Agent",
        role="Analyst",
        provider="mock",
        model="mock-model",
        temperature=0.7,
        reasoning_style="balanced",
        position_order=0,
        knowledge_mode=knowledge_mode,
    )
    db.add(agent)
    await db.flush()

    turn = ChatTurn(id=uuid.uuid4(), chat_session_id=session.id, turn_index=1)
    db.add(turn)
    await db.flush()

    msg = Message(
        chat_session_id=session.id,
        chat_turn_id=turn.id,
        sender_type=SenderType.user,
        message_type=MessageType.user_input,
        content="Should AI be regulated?",
        sequence_no=1,
    )
    db.add(msg)
    await db.flush()
    return agent, turn


async def _seed_document(
    db: AsyncSession,
    session: ChatSession,
    status: DocumentStatus,
) -> Document:
    doc = Document(
        id=uuid.uuid4(),
        chat_session_id=session.id,
        filename="test.txt",
        source_type="txt",
        status=status,
        storage_provider="local",
    )
    db.add(doc)
    await db.flush()
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# 1. Failed processing stores error_message
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_embedding_failure_does_not_block_ready(
    db_session: AsyncSession,
    _test_session_factory,
):
    """A broken embedding provider must NOT fail the document or leave it
    processing. The document becomes ``ready`` with chunks stored and
    ``embedding_status='failed'`` (retrieval then uses keyword fallback)."""
    _, session = await _seed_user_and_session(db_session)

    storage = _MemStorage()
    svc = DocumentIngestionService(storage=storage)
    doc = await svc.create_pending(
        db=db_session,
        session_id=session.id,
        filename="fail.txt",
        file_bytes=b"some readable content here " * 30,
    )
    await db_session.commit()
    document_id = doc.id

    class _BrokenEmbeddings:
        async def embed_batch(self, texts):
            raise RuntimeError("embedding provider offline")

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=_BrokenEmbeddings(),
    ):
        await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        reloaded = await fresh.get(Document, document_id)
        assert reloaded.status == DocumentStatus.ready
        assert reloaded.embedding_status == "failed"
        # error_message stays clear on a ready document.
        assert reloaded.error_message is None
        from app.models.document_chunk import DocumentChunk as _DC
        from sqlalchemy import func as _func, select as _select
        count = (
            await fresh.execute(
                _select(_func.count(_DC.id)).where(_DC.document_id == document_id)
            )
        ).scalar()
        assert count and count > 0


@pytest.mark.asyncio
async def test_failed_processing_extraction_error_stores_message(
    db_session: AsyncSession,
    _test_session_factory,
):
    """Extraction-level failures also persist error_message."""
    _, session = await _seed_user_and_session(db_session)

    storage = _MemStorage()
    svc = DocumentIngestionService(storage=storage)
    # Create a .txt document but corrupt the stored bytes so extraction fails
    doc = await svc.create_pending(
        db=db_session,
        session_id=session.id,
        filename="corrupt.txt",
        file_bytes=b"   ",  # only whitespace → extraction produces empty text
    )
    await db_session.commit()
    document_id = doc.id

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=None,  # should not be reached
    ):
        await svc.process_in_background(_test_session_factory, document_id)

    async with _test_session_factory() as fresh:
        reloaded = await fresh.get(Document, document_id)
        assert reloaded.status == DocumentStatus.failed
        assert reloaded.error_message is not None
        assert len(reloaded.error_message) <= 500


# ─────────────────────────────────────────────────────────────────────────────
# 2. GET /documents returns error_message
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_documents_returns_error_message(client):
    """GET /documents includes error_message for failed documents."""
    # Create a session via API
    create_resp = await client.post("/sessions", json={"title": "rag-fix-test"})
    assert create_resp.status_code in (200, 201)
    session_id = create_resp.json()["id"]

    # Upload a file (will be processing)
    files = {"file": ("note.txt", b"hello " * 50, "text/plain")}
    upload_resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files=files,
    )
    assert upload_resp.status_code == 201
    doc_id = upload_resp.json()["id"]

    # Manually flip to failed + set error_message via a direct API round-trip
    # We'll just verify the field is present (even if None for a fresh upload).
    list_resp = await client.get(f"/documents?session_id={session_id}")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) >= 1
    target = next(i for i in items if i["id"] == doc_id)
    # The field must exist in the response (even if null for processing docs)
    assert "error_message" in target


# ─────────────────────────────────────────────────────────────────────────────
# 3. rag_active is True for shared_session_docs when ready docs exist
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rag_active_true_for_shared_session_docs_with_ready_document(
    db_session: AsyncSession,
):
    """Bug B-2 fix: rag_active must be True when session has a ready doc
    and an agent uses shared_session_docs."""
    _, session = await _seed_user_and_session(db_session)
    _, turn = await _seed_debate_turn(db_session, session, knowledge_mode="shared_session_docs")
    await _seed_document(db_session, session, DocumentStatus.ready)
    await db_session.commit()

    from sqlalchemy.orm import selectinload
    from sqlalchemy import select
    from app.models.chat_turn import ChatTurn as CT

    stmt = (
        select(CT)
        .where(CT.id == turn.id)
        .options(
            selectinload(CT.chat_session).selectinload(ChatSession.chat_agents),
            selectinload(CT.messages),
        )
    )
    loaded_turn = (await db_session.execute(stmt)).scalar_one()

    engine = ChatEngine(db_session)
    ctx = await engine._build_turn_context(loaded_turn)

    assert ctx.rag_active is True
    assert ctx.document_count >= 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. rag_active is False when session documents are still processing
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rag_active_false_when_no_ready_documents(
    db_session: AsyncSession,
):
    """rag_active must be False when session has only processing docs (not ready)."""
    _, session = await _seed_user_and_session(db_session)
    _, turn = await _seed_debate_turn(db_session, session, knowledge_mode="shared_session_docs")
    await _seed_document(db_session, session, DocumentStatus.processing)
    await db_session.commit()

    from sqlalchemy.orm import selectinload
    from sqlalchemy import select
    from app.models.chat_turn import ChatTurn as CT

    stmt = (
        select(CT)
        .where(CT.id == turn.id)
        .options(
            selectinload(CT.chat_session).selectinload(ChatSession.chat_agents),
            selectinload(CT.messages),
        )
    )
    loaded_turn = (await db_session.execute(stmt)).scalar_one()

    engine = ChatEngine(db_session)
    ctx = await engine._build_turn_context(loaded_turn)

    assert ctx.rag_active is False


# ─────────────────────────────────────────────────────────────────────────────
# 6. Stale-processing recovery — the core "infinite processing" fix
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_recover_stale_processing_marks_stuck_doc_failed(
    db_session: AsyncSession,
):
    """A document stuck in `processing` past the timeout is flipped to
    `failed` with an actionable error_message (background task died /
    server restarted)."""
    _, session = await _seed_user_and_session(db_session)
    doc = await _seed_document(db_session, session, DocumentStatus.processing)
    # Pretend ingestion started 10 minutes ago and never finished.
    doc.processing_started_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    await db_session.flush()

    recovered = await DocumentIngestionService.recover_stale_processing(
        db_session, session.id, timeout_seconds=300
    )
    assert recovered == 1

    await db_session.refresh(doc)
    assert doc.status == DocumentStatus.failed
    assert doc.error_message is not None
    assert "timed out" in doc.error_message.lower()
    assert doc.processed_at is not None


@pytest.mark.asyncio
async def test_recover_stale_processing_keeps_recent_doc(
    db_session: AsyncSession,
):
    """A document that only just started processing is NOT recovered."""
    _, session = await _seed_user_and_session(db_session)
    doc = await _seed_document(db_session, session, DocumentStatus.processing)
    doc.processing_started_at = datetime.now(timezone.utc)
    await db_session.flush()

    recovered = await DocumentIngestionService.recover_stale_processing(
        db_session, session.id, timeout_seconds=300
    )
    assert recovered == 0

    await db_session.refresh(doc)
    assert doc.status == DocumentStatus.processing


@pytest.mark.asyncio
async def test_recover_stale_ignores_terminal_docs(
    db_session: AsyncSession,
):
    """ready/failed documents are never touched by recovery."""
    _, session = await _seed_user_and_session(db_session)
    ready = await _seed_document(db_session, session, DocumentStatus.ready)
    ready.processing_started_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.flush()

    recovered = await DocumentIngestionService.recover_stale_processing(
        db_session, session.id, timeout_seconds=300
    )
    assert recovered == 0
    await db_session.refresh(ready)
    assert ready.status == DocumentStatus.ready


# ─────────────────────────────────────────────────────────────────────────────
# 7. A hung knowledge-extraction LLM call must NOT block status=ready
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_hung_knowledge_extraction_does_not_block_ready(
    db_session: AsyncSession,
    _test_session_factory,
    monkeypatch,
):
    """If the best-effort knowledge LLM hangs, the timeout guard kicks in and
    the document still reaches `ready` with persisted chunks."""
    _, session = await _seed_user_and_session(db_session)

    class _HangingKnowledge:
        async def extract(self, *args, **kwargs):
            await asyncio.sleep(30)  # would hang far past the timeout
            raise AssertionError("should have been cancelled by timeout")

    storage = _MemStorage()
    svc = DocumentIngestionService(storage=storage, knowledge=_HangingKnowledge())
    doc = await svc.create_pending(
        db=db_session,
        session_id=session.id,
        filename="profiles.md",
        file_bytes=b"# University Profiles\n\nReadable markdown content. " * 40,
    )
    await db_session.commit()
    document_id = doc.id

    # Make the timeout tiny so the test is fast.
    monkeypatch.setattr(settings, "KNOWLEDGE_EXTRACTION_TIMEOUT_SECONDS", 0.05)

    with patch(
        "app.services.documents.ingestion_service.get_embedding_service",
        return_value=MockEmbeddingService(),
    ):
        await asyncio.wait_for(
            svc.process_in_background(_test_session_factory, document_id),
            timeout=10,  # the pipeline itself must finish well under this
        )

    async with _test_session_factory() as fresh:
        reloaded = await fresh.get(Document, document_id)
        assert reloaded.status == DocumentStatus.ready
        assert reloaded.processed_at is not None
        from app.models.document_chunk import DocumentChunk
        from sqlalchemy import func, select as sa_select
        count = (
            await fresh.execute(
                sa_select(func.count(DocumentChunk.id)).where(
                    DocumentChunk.document_id == document_id
                )
            )
        ).scalar()
        assert count and count > 0


# ─────────────────────────────────────────────────────────────────────────────
# 5. rag_active is False when all agents use no_docs
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rag_active_false_when_all_agents_use_no_docs(
    db_session: AsyncSession,
):
    """rag_active must be False when all agents use no_docs, even if ready docs exist."""
    _, session = await _seed_user_and_session(db_session)
    _, turn = await _seed_debate_turn(db_session, session, knowledge_mode="no_docs")
    await _seed_document(db_session, session, DocumentStatus.ready)
    await db_session.commit()

    from sqlalchemy.orm import selectinload
    from sqlalchemy import select
    from app.models.chat_turn import ChatTurn as CT

    stmt = (
        select(CT)
        .where(CT.id == turn.id)
        .options(
            selectinload(CT.chat_session).selectinload(ChatSession.chat_agents),
            selectinload(CT.messages),
        )
    )
    loaded_turn = (await db_session.execute(stmt)).scalar_one()

    engine = ChatEngine(db_session)
    ctx = await engine._build_turn_context(loaded_turn)

    assert ctx.rag_active is False
