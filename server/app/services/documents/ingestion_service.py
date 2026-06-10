"""
Document Ingestion Service — orchestrates the full RAG ingestion pipeline.

Deterministic, synchronous pipeline (RAG upload refactor)
─────────────────────────────────────────────────────────
Processing is **synchronous** and **embedding-independent**. The upload route
awaits ``process_upload(...)`` and only returns once each document has reached a
terminal state (``ready`` or ``failed``). There is no background task / queue on
the default path, so a document can never get stuck in ``processing`` forever.

Per uploaded file (``process_upload`` → ``_process_document``):

  1. Persist raw bytes via the configured DocumentStorageService
     (local disk or Cloudinary) and mark ``status = processing``.
  2. Extract text  (extractor.py).  Empty → ``failed``.
  3. Chunk text    (chunker.py).    Empty → ``failed``.
  4. Persist DocumentChunk rows (plain text, ``embedding = NULL``).
  5. Set ``status = ready`` immediately — the document is now retrievable via
     keyword fallback. This is the only hard requirement for readiness.
  6. Best-effort: embed the chunks and backfill ``embedding`` vectors, setting
     ``embedding_status`` to ready / failed / disabled. A broken embedding
     provider NEVER fails the document — RAG simply uses keyword retrieval.
  7. Best-effort: knowledge-intelligence metadata (timeout-guarded).

Crucial invariant: every code path that sets ``status = processing`` is followed
by a guaranteed transition to ``ready`` or ``failed`` (see ``process_upload``).

Legacy / compatibility
───────────────────────
  * ``create_pending(...)`` — creates the Document row + uploads bytes + marks
    ``processing``. Used as phase A by ``process_upload`` and directly by tests.
  * ``ingest(...)`` — synchronous full pipeline (alias of ``process_upload``).
  * ``process_in_background(...)`` — retained for compatibility and offline
    re-processing. It is NO LONGER on the default upload path, but funnels
    through the same ``_process_document`` so it shares the reliable semantics.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings

from app.models.document import Document, DocumentStatus, EmbeddingStatus
from app.models.document_chunk import DocumentChunk
from app.services.documents.extractor import (
    ExtractionError,
    extract_text,
    extension_from_filename,
    supported_extensions,
)
from app.services.documents.chunker import chunk_text
from app.services.embeddings.embedding_service import get_embedding_service
from app.services.knowledge import KnowledgeExtractionService
from app.services.storage import (
    DocumentStorageError,
    DocumentStorageService,
    StoredFile,
    get_storage_service,
)

logger = logging.getLogger(__name__)


class DocumentIngestionError(Exception):
    """Raised when the ingestion pipeline fails fatally."""


def safe_error_message(exc: BaseException, *, limit: int = 500) -> str:
    """Render an exception into a short, user-safe message (no secrets/stack)."""
    msg = str(exc).strip() or exc.__class__.__name__
    # Defensive: never echo anything that looks like a bearer/api key.
    if "sk-" in msg or "Bearer " in msg:
        msg = exc.__class__.__name__
    return msg[:limit]


def _is_all_zero(vector) -> bool:
    """True when every component of the vector is (near) zero — the signature
    of MockEmbeddingService / an unconfigured provider."""
    try:
        return not any(abs(float(v)) > 1e-9 for v in vector)
    except TypeError:
        return True


class DocumentIngestionService:
    """
    Orchestrates document upload → text extraction → chunking → embedding → storage.

    Instantiated per request (stateless — holds no mutable state).
    """

    def __init__(
        self,
        storage: DocumentStorageService | None = None,
        knowledge: KnowledgeExtractionService | None = None,
    ) -> None:
        self._storage = storage or get_storage_service()
        # Step 31: knowledge extractor is optional and best-effort. ``None`` ⇒
        # auto-construct on first use; pass an explicit instance in tests to
        # avoid any LLM call. Failures NEVER block the document from going ready.
        self._knowledge = knowledge

    # ── Phase A: synchronous, request-scoped ──────────────────────────────────

    async def create_pending(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
        content_type: str | None = None,
    ) -> Document:
        """Create the Document row, upload to storage, mark ``processing``.

        Returns immediately after the storage upload. The actual text
        extraction / chunking / embedding must be scheduled separately
        via :meth:`process_in_background`.

        Raises:
            DocumentIngestionError on unsupported type or storage failure.
        """
        ext = extension_from_filename(filename)
        if ext not in supported_extensions():
            raise DocumentIngestionError(
                f"Unsupported file type '{ext}'. "
                f"Supported: {', '.join(sorted(supported_extensions()))}"
            )

        doc = Document(
            chat_session_id=session_id,
            filename=filename,
            file_path=None,
            source_type=ext.lstrip("."),
            status=DocumentStatus.uploaded,
            storage_provider=self._storage.provider_name,
            original_filename=filename,
            content_type=content_type,
        )
        db.add(doc)
        await db.flush()  # generates doc.id

        logger.info(
            "document_upload_start session=%s document=%s filename=%s size=%d",
            session_id, doc.id, filename, len(file_bytes),
        )
        try:
            stored = await self._storage.upload_bytes(
                content=file_bytes,
                document_id=doc.id,
                session_id=session_id,
                filename=filename,
                content_type=content_type,
            )
        except DocumentStorageError as exc:
            doc.status = DocumentStatus.failed
            await db.flush()
            raise DocumentIngestionError(f"Storage upload failed: {exc}") from exc

        _apply_stored_file(doc, stored)
        doc.status = DocumentStatus.processing
        doc.processing_started_at = datetime.now(timezone.utc)
        await db.flush()
        return doc

    # ── Phase B: background, uses its own DB session ──────────────────────────

    async def process_in_background(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        document_id: uuid.UUID,
    ) -> None:
        """Run the heavy pipeline (extract → chunk → embed → knowledge) for
        a previously-created Document, in a fresh DB session.

        Safe to call from a FastAPI ``BackgroundTasks`` queue. Never
        raises — every failure is logged and persisted on the Document
        row as ``status=failed``.

        Idempotency:
          * If the Document was deleted, exits silently.
          * If the Document is not in ``processing`` state any more
            (``ready`` / ``failed`` / ``uploaded``), exits without work.
          * Existing chunks for the document are wiped before re-insert
            so a retried task never produces duplicates.
        """
        async with session_factory() as db:
            try:
                doc = await db.get(Document, document_id)
                if doc is None:
                    logger.info(
                        "document_background_skip document=%s reason=deleted",
                        document_id,
                    )
                    return
                if doc.status != DocumentStatus.processing:
                    logger.info(
                        "document_background_skip document=%s status=%s",
                        document_id, doc.status.value,
                    )
                    return

                # Idempotency: clear any chunks left over from a previous
                # failed attempt so we never accumulate duplicates.
                await db.execute(
                    delete(DocumentChunk).where(
                        DocumentChunk.document_id == document_id
                    )
                )

                # Load the raw bytes from storage so we don't rely on
                # request-scoped buffers.
                stored = self.stored_file_from_doc(doc)
                file_bytes = await self._storage.download_bytes(stored)

                await self._process_document(db, doc, file_bytes, doc.filename)
                await db.commit()
            except DocumentIngestionError as exc:
                logger.warning(
                    "document_background_failed document=%s reason=%s",
                    document_id, exc,
                )
                await self._mark_failed(db, document_id, error_message=str(exc))
            except Exception as exc:  # noqa: BLE001 — never let bg task crash
                logger.exception(
                    "document_background_unexpected document=%s reason=%s",
                    document_id, exc,
                )
                await self._mark_failed(db, document_id, error_message=str(exc))

    async def _mark_failed(
        self,
        db: AsyncSession,
        document_id: uuid.UUID,
        error_message: str | None = None,
    ) -> None:
        """Best-effort: set status=failed in a new transaction. Swallows
        all errors so the background task never raises."""
        try:
            await db.rollback()
            doc = await db.get(Document, document_id)
            if doc is None:
                return
            doc.status = DocumentStatus.failed
            doc.updated_at = datetime.now(timezone.utc)
            doc.processed_at = datetime.now(timezone.utc)
            if error_message:
                doc.error_message = error_message[:500]
            await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception(
                "document_background_mark_failed_failed document=%s",
                document_id,
            )

    # ── Synchronous, deterministic entry point ───────────────────────────────

    async def process_upload(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
        content_type: str | None = None,
    ) -> Document:
        """Run the full pipeline synchronously and return a *terminal* Document.

        The returned document is guaranteed to be in a terminal state
        (``ready`` or ``failed``) — never ``processing``. This is the method
        the upload routes await so the HTTP response carries final statuses.

        Behaviour:
          * Validation errors (unsupported type, storage upload failure) are
            raised as :class:`DocumentIngestionError` *before/at* row creation
            so the route can surface them as a per-file failure.
          * Once a Document row exists, every error is caught and persisted as
            ``status=failed`` with an ``error_message`` — the function never
            leaves a row stuck in ``processing`` and (for processing errors)
            never raises.

        A transient ``doc._ingest_chunk_count`` attribute carries the chunk
        count back to the caller without an extra query.
        """
        logger.info(
            "[RAG Upload] processing file=%s session=%s size=%d",
            filename, session_id, len(file_bytes),
        )
        # Phase A — create row + store bytes + status=processing. May raise
        # DocumentIngestionError (unsupported type / storage) which the caller
        # turns into a per-file failure. No row leaks in that case.
        doc = await self.create_pending(
            db=db,
            session_id=session_id,
            filename=filename,
            file_bytes=file_bytes,
            content_type=content_type,
        )

        # Phase B — process to a terminal state. The try/finally invariant: a
        # Document that entered ``processing`` always leaves it.
        try:
            await self._process_document(db, doc, file_bytes, filename)
        except DocumentIngestionError as exc:
            await self._finalize_failed(db, doc, safe_error_message(exc))
        except Exception as exc:  # noqa: BLE001 — never leave it processing
            logger.exception(
                "[RAG Status] file=%s document=%s unexpected error", filename, doc.id,
            )
            await self._finalize_failed(db, doc, safe_error_message(exc))
        return doc

    # Backwards-compatible alias. Older callers / tests import ``ingest``.
    ingest = process_upload

    async def _finalize_failed(
        self, db: AsyncSession, doc: Document, message: str,
    ) -> None:
        """Persist a terminal ``failed`` state on ``doc`` (request session)."""
        now = datetime.now(timezone.utc)
        doc.status = DocumentStatus.failed
        doc.error_message = message
        doc.embedding_status = EmbeddingStatus.disabled.value
        doc.processed_at = now
        doc.updated_at = now
        doc._ingest_chunk_count = 0  # type: ignore[attr-defined]
        await db.flush()
        logger.info(
            "[RAG Status] file=%s document=%s status=failed error=%s",
            doc.filename, doc.id, message,
        )

    async def _process_document(
        self,
        db: AsyncSession,
        doc: Document,
        file_bytes: bytes,
        filename: str,
    ) -> int:
        """Extract → chunk → store → ready, then embed (best-effort).

        Returns the number of chunks stored. Raises
        :class:`DocumentIngestionError` ONLY for hard failures that should mark
        the document ``failed`` (no extractable text / no chunks). Embedding
        failures are swallowed and recorded on ``embedding_status`` — they never
        raise and never block readiness.
        """
        # 1. Extract text.
        try:
            text = extract_text(file_bytes, filename)
        except ExtractionError as exc:
            raise DocumentIngestionError(f"Text extraction failed: {exc}") from exc

        if not text.strip():
            raise DocumentIngestionError("No extractable text found in the document.")

        logger.info(
            "[RAG Extract] file=%s document=%s textLength=%d",
            filename, doc.id, len(text),
        )

        # 2. Chunk.
        chunks = chunk_text(text)
        if not chunks:
            raise DocumentIngestionError("No chunks created from the document text.")

        logger.info(
            "[RAG Chunk] file=%s document=%s chunks=%d", filename, doc.id, len(chunks),
        )

        # 3. Persist chunks WITHOUT embeddings. Plain text in the DB is the only
        # hard requirement for retrieval — keyword fallback works on it even if
        # the embedding provider is down. We keep the row handles to backfill
        # vectors in the best-effort step below.
        chunk_rows: list[DocumentChunk] = []
        for idx, content in enumerate(chunks):
            row = DocumentChunk(
                document_id=doc.id,
                chunk_index=idx,
                content=content,
                embedding=None,
            )
            db.add(row)
            chunk_rows.append(row)
        await db.flush()

        logger.info(
            "[RAG Store] file=%s document=%s savedChunks=%d",
            filename, doc.id, len(chunk_rows),
        )

        # 4. Mark READY now — before embeddings and before the best-effort
        # knowledge step. This guarantees a slow/broken embedding provider or a
        # hung knowledge LLM can never leave the document spinning forever.
        now = datetime.now(timezone.utc)
        doc.status = DocumentStatus.ready
        doc.error_message = None
        doc.embedding_status = EmbeddingStatus.pending.value
        doc.processed_at = now
        doc.updated_at = now
        doc._ingest_chunk_count = len(chunk_rows)  # type: ignore[attr-defined]
        await db.flush()

        logger.info(
            "[RAG Status] file=%s document=%s status=ready chunks=%d",
            filename, doc.id, len(chunk_rows),
        )

        # 5. Best-effort embeddings — augmentation only, never fails the doc.
        await self._embed_chunks_best_effort(db, doc, chunk_rows)
        await db.flush()

        # 6. Best-effort knowledge intelligence (timeout-guarded).
        await self._extract_knowledge_metadata(doc, chunks)
        await db.flush()

        return len(chunk_rows)

    async def _embed_chunks_best_effort(
        self,
        db: AsyncSession,
        doc: Document,
        chunk_rows: list[DocumentChunk],
    ) -> None:
        """Embed stored chunks and backfill vectors. Never raises.

        Sets ``doc.embedding_status``:
          ready    — real (non-zero) vectors stored for every chunk
          disabled — provider returned all-zero vectors (mock / offline dev)
          failed   — provider raised or returned a malformed batch
        """
        contents = [c.content for c in chunk_rows]
        if not contents:
            doc.embedding_status = EmbeddingStatus.disabled.value
            return

        try:
            embedding_svc = get_embedding_service()
            vectors = await embedding_svc.embed_batch(contents)
        except Exception as exc:  # noqa: BLE001 — embeddings are best-effort
            doc.embedding_status = EmbeddingStatus.failed.value
            logger.warning(
                "[RAG Embed] file=%s document=%s status=failed error=%s "
                "(document stays ready — keyword retrieval will be used)",
                doc.filename, doc.id, safe_error_message(exc),
            )
            return

        if not isinstance(vectors, list) or len(vectors) != len(chunk_rows):
            doc.embedding_status = EmbeddingStatus.failed.value
            logger.warning(
                "[RAG Embed] file=%s document=%s status=failed reason=count_mismatch "
                "got=%s want=%d",
                doc.filename, doc.id,
                len(vectors) if isinstance(vectors, list) else type(vectors).__name__,
                len(chunk_rows),
            )
            return

        # All-zero vectors ⇒ MockEmbeddingService / unconfigured provider. The
        # chunks stay keyword-only; flag the truth so /rag-health is honest.
        if all(_is_all_zero(v) for v in vectors):
            doc.embedding_status = EmbeddingStatus.disabled.value
            logger.info(
                "[RAG Embed] file=%s document=%s status=disabled "
                "(all-zero vectors — keyword retrieval only)",
                doc.filename, doc.id,
            )
            return

        try:
            for row, vector in zip(chunk_rows, vectors):
                row.embedding = vector
        except Exception as exc:  # noqa: BLE001 — defensive
            doc.embedding_status = EmbeddingStatus.failed.value
            logger.warning(
                "[RAG Embed] file=%s document=%s status=failed error=%s",
                doc.filename, doc.id, safe_error_message(exc),
            )
            return

        doc.embedding_status = EmbeddingStatus.ready.value
        logger.info(
            "[RAG Embed] file=%s document=%s status=ready vectors=%d",
            doc.filename, doc.id, len(vectors),
        )

    async def _extract_knowledge_metadata(
        self,
        doc: Document,
        chunks: list[str],
    ) -> None:
        """Run the knowledge extractor and copy results onto ``doc``.

        Any failure is swallowed — knowledge metadata is augmentation, not a
        gate. The ingestion path stays green even if the LLM is unreachable.
        """
        try:
            if self._knowledge is None:
                self._knowledge = KnowledgeExtractionService()

            # Hard timeout so a hung LLM provider can never freeze ingestion.
            # The document is already ``ready`` at this point — knowledge is
            # pure augmentation.
            metadata = await asyncio.wait_for(
                self._knowledge.extract(
                    chunks,
                    filename=doc.filename,
                    source_type=doc.source_type or "",
                ),
                timeout=float(settings.KNOWLEDGE_EXTRACTION_TIMEOUT_SECONDS),
            )
            doc.document_type = metadata.document_type
            doc.document_summary = metadata.summary or None
            doc.knowledge_metadata = metadata.to_dict()

            logger.info(
                "document_knowledge_extracted document=%s status=%s type=%s "
                "topics=%d claims=%d",
                doc.id,
                metadata.extraction_status,
                metadata.document_type,
                len(metadata.main_topics),
                len(metadata.key_claims),
            )
        except Exception as exc:  # noqa: BLE001 — knowledge is best-effort
            logger.warning(
                "document_knowledge_extraction_failed document=%s reason=%s",
                doc.id, exc,
            )

    # ── Storage helpers used by routes ────────────────────────────────────────

    @staticmethod
    def stored_file_from_doc(doc: Document) -> StoredFile:
        """Reconstruct a StoredFile handle from a persisted Document row."""
        return StoredFile(
            storage_provider=doc.storage_provider or "local",
            original_filename=doc.original_filename or doc.filename,
            public_id=doc.storage_public_id,
            url=doc.storage_url,
            secure_url=doc.storage_secure_url,
            resource_type=doc.storage_resource_type,
            format=doc.storage_format,
            bytes=doc.storage_bytes,
            content_type=doc.content_type,
            local_path=doc.file_path,
        )

    # ── Query helpers used by the route ───────────────────────────────────────

    @staticmethod
    async def recover_stale_processing(
        db: AsyncSession,
        session_id: uuid.UUID,
        timeout_seconds: int | None = None,
    ) -> int:
        """Flip documents stuck in ``processing`` past the timeout to ``failed``.

        FastAPI ``BackgroundTasks`` do not survive a process restart, and on
        serverless platforms (Cloud Run) CPU can be throttled the moment the
        HTTP response is sent — so an ingestion task may never finish. Such a
        document would otherwise stay ``processing`` forever. The status
        endpoint calls this so polling is self-healing: a stale document
        becomes ``failed`` with an actionable message instead of an infinite
        spinner.

        Returns the number of documents recovered.
        """
        if timeout_seconds is None:
            timeout_seconds = int(settings.DOCUMENT_PROCESSING_TIMEOUT_SECONDS)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=timeout_seconds)

        rows = (
            await db.execute(
                select(Document)
                .where(Document.chat_session_id == session_id)
                .where(Document.status == DocumentStatus.processing)
            )
        ).scalars().all()

        recovered = 0
        for doc in rows:
            started = doc.processing_started_at or doc.created_at
            if started is None:
                continue
            # Normalize naive timestamps (older rows) to UTC for comparison.
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if started <= cutoff:
                doc.status = DocumentStatus.failed
                doc.processed_at = now
                doc.updated_at = now
                doc.error_message = (
                    "Processing timed out — the ingestion task did not finish "
                    "(the server may have restarted). Please re-upload the file."
                )
                recovered += 1
                logger.warning(
                    "document_stale_recovered session=%s document=%s filename=%s "
                    "started=%s",
                    session_id, doc.id, doc.filename, started.isoformat(),
                )

        if recovered:
            await db.flush()
        return recovered

    @staticmethod
    async def get_for_user(
        db: AsyncSession,
        session_id: uuid.UUID,
    ) -> list[Document]:
        """Return all documents for a given chat session, newest first."""
        from app.models.chat_session import ChatSession  # noqa: PLC0415, F401
        stmt = (
            select(Document)
            .where(Document.chat_session_id == session_id)
            .order_by(Document.created_at.desc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_all_for_user(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> list[tuple[Document, str | None]]:
        """Return (Document, session_title) tuples for all documents owned by user, newest first."""
        from app.models.chat_session import ChatSession  # noqa: PLC0415
        stmt = (
            select(Document, ChatSession.title)
            .join(ChatSession, Document.chat_session_id == ChatSession.id)
            .where(ChatSession.user_id == user_id)
            .order_by(Document.created_at.desc())
        )
        result = await db.execute(stmt)
        return [(row.Document, row.title) for row in result.all()]

    @staticmethod
    async def get_by_id(
        db: AsyncSession,
        document_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> Document | None:
        """Return a Document only if it belongs to the given session."""
        stmt = (
            select(Document)
            .where(Document.id == document_id)
            .where(Document.chat_session_id == session_id)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


def _apply_stored_file(doc: Document, stored: StoredFile) -> None:
    """Copy storage metadata from a StoredFile back onto a Document row."""
    doc.storage_provider = stored.storage_provider
    doc.storage_public_id = stored.public_id
    doc.storage_url = stored.url
    doc.storage_secure_url = stored.secure_url
    doc.storage_resource_type = stored.resource_type
    doc.storage_format = stored.format
    doc.storage_bytes = stored.bytes
    doc.content_type = stored.content_type or doc.content_type
    doc.original_filename = stored.original_filename or doc.original_filename
    if stored.local_path:
        doc.file_path = stored.local_path

