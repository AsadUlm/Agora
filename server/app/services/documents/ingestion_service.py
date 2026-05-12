"""
Document Ingestion Service — orchestrates the full RAG ingestion pipeline.

Pipeline per uploaded file:
  1. Persist raw bytes via the configured DocumentStorageService
     (local disk or Cloudinary).
  2. Update Document.status = processing
  3. Extract text  (extractor.py)
  4. Chunk text    (chunker.py)
  5. Embed chunks in batch  (EmbeddingService)
  6. Persist DocumentChunk rows with embeddings
  7. Update Document.status = ready (or failed on any error)

If extraction/embedding fails after a successful storage upload, the file is
removed from storage to avoid orphan blobs (Step 30).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentStatus
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

    # ── Main entry point ───────────────────────────────────────────────────────

    async def ingest(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
        content_type: str | None = None,
    ) -> Document:
        """
        Run the full ingestion pipeline for one uploaded file.

        Returns the persisted Document record (status='ready' on success).

        Raises:
            DocumentIngestionError on unsupported type, extraction fail, or empty doc.
        """
        ext = extension_from_filename(filename)

        if ext not in supported_extensions():
            raise DocumentIngestionError(
                f"Unsupported file type '{ext}'. "
                f"Supported: {', '.join(sorted(supported_extensions()))}"
            )

        # ── 1. Create Document record ─────────────────────────────────────────
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

        # ── 2. Upload bytes to storage backend ────────────────────────────────
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
        await db.flush()

        # ── 3–6. Extract → Chunk → Embed → Store ─────────────────────────────
        try:
            await self._process_document(db, doc, file_bytes, filename)
        except DocumentIngestionError:
            doc.status = DocumentStatus.failed
            await db.flush()
            # Best-effort: remove orphan storage object so we don't leak blobs.
            try:
                await self._storage.delete(stored)
            except Exception as cleanup_exc:  # noqa: BLE001
                logger.warning(
                    "document_upload_orphan_cleanup_failed document=%s reason=%s",
                    doc.id, cleanup_exc,
                )
            raise

        return doc

    async def _process_document(
        self,
        db: AsyncSession,
        doc: Document,
        file_bytes: bytes,
        filename: str,
    ) -> None:
        # 3. Extract text
        try:
            text = extract_text(file_bytes, filename)
        except ExtractionError as exc:
            raise DocumentIngestionError(f"Text extraction failed: {exc}") from exc

        if not text.strip():
            raise DocumentIngestionError("Document contains no extractable text.")

        logger.info("document_extract_done document=%s chars=%d", doc.id, len(text))

        # 4. Chunk
        chunks = chunk_text(text)
        if not chunks:
            raise DocumentIngestionError("Chunking produced zero chunks.")

        logger.info(
            "document_chunks_created document=%s count=%d",
            doc.id, len(chunks),
        )

        # 5. Embed (batch — one API call for all chunks)
        embedding_svc = get_embedding_service()
        try:
            vectors = await embedding_svc.embed_batch(chunks)
        except Exception as exc:
            logger.error("Document %s: embedding failed: %s", doc.id, exc)
            # Store chunks without embeddings and mark failed
            for idx, content in enumerate(chunks):
                db.add(DocumentChunk(
                    document_id=doc.id,
                    chunk_index=idx,
                    content=content,
                    embedding=None,
                ))
            doc.status = DocumentStatus.failed
            await db.flush()
            raise DocumentIngestionError(f"Embedding failed: {exc}") from exc

        # 6. Persist chunks
        for idx, (content, vector) in enumerate(zip(chunks, vectors)):
            db.add(DocumentChunk(
                document_id=doc.id,
                chunk_index=idx,
                content=content,
                embedding=vector,
            ))

        # 7. Step 31 — Knowledge intelligence layer (best-effort, never blocks).
        await self._extract_knowledge_metadata(doc, chunks)

        doc.status = DocumentStatus.ready
        doc.updated_at = datetime.now(timezone.utc)
        await db.flush()

        logger.info(
            "document_embedding_done document=%s chunks=%d status=ready",
            doc.id, len(chunks),
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

            metadata = await self._knowledge.extract(
                chunks,
                filename=doc.filename,
                source_type=doc.source_type or "",
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

