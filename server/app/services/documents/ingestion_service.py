"""
Document Ingestion Service — orchestrates the full RAG ingestion pipeline.

Pipeline per uploaded file:
  1. Save raw bytes to local filesystem (UPLOAD_DIR / {document_id}{ext})
  2. Update Document.status = processing
  3. Extract text  (extractor.py)
  4. Chunk text    (chunker.py)
  5. Embed chunks in batch  (EmbeddingService)
  6. Persist DocumentChunk rows with embeddings
  7. Update Document.status = ready (or failed on any error)

The service is async throughout and uses the provided AsyncSession directly —
no background tasks added here; callers decide whether to run inline or as a
background task (the route does inline for small files; it's fast enough).

Ownership:
  Documents are always tied to a ChatSession (chat_session_id).  The session
  belongs to a user, so selecting Document WHERE chat_session.user_id = current_user
  enforces ownership without adding a redundant user_id FK to documents.

Failure handling:
  - UnsupportedFileType   → Document.status = failed, error stored, re-raised
  - ExtractionError       → same
  - EmbeddingError        → chunks saved without embedding (partial), status = failed
  - Empty text            → status = failed, re-raised
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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

logger = logging.getLogger(__name__)


class DocumentIngestionError(Exception):
    """Raised when the ingestion pipeline fails fatally."""


class DocumentIngestionService:
    """
    Orchestrates document upload → text extraction → chunking → embedding → storage.

    Instantiated per request (stateless — holds no mutable state).
    """

    # ── Upload helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _upload_path(document_id: uuid.UUID, ext: str) -> Path:
        upload_dir = Path(settings.UPLOAD_DIR)
        upload_dir.mkdir(parents=True, exist_ok=True)
        return upload_dir / f"{document_id}{ext}"

    # ── Main entry point ───────────────────────────────────────────────────────

    async def ingest(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        filename: str,
        file_bytes: bytes,
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
            file_path="",  # filled after we know the ID
            source_type=ext.lstrip("."),
            status=DocumentStatus.uploaded,
        )
        db.add(doc)
        await db.flush()  # generates doc.id

        # ── 2. Save file to disk ──────────────────────────────────────────────
        file_path = self._upload_path(doc.id, ext)
        file_path.write_bytes(file_bytes)
        doc.file_path = str(file_path)
        doc.status = DocumentStatus.processing
        await db.flush()

        logger.info(
            "Document %s: saved %d bytes to %s",
            doc.id, len(file_bytes), file_path,
        )

        # ── 3–6. Extract → Chunk → Embed → Store ─────────────────────────────
        try:
            await self._process_document(db, doc, file_bytes, filename)
        except DocumentIngestionError:
            doc.status = DocumentStatus.failed
            await db.flush()
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

        # 4. Chunk
        chunks = chunk_text(text)
        if not chunks:
            raise DocumentIngestionError("Chunking produced zero chunks.")

        logger.info("Document %s: %d chunks from %d chars", doc.id, len(chunks), len(text))

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

        doc.status = DocumentStatus.ready
        doc.updated_at = datetime.now(timezone.utc)
        await db.flush()

        logger.info("Document %s: ingestion complete (status=ready)", doc.id)

    # ── Query helpers used by the route ───────────────────────────────────────

    @staticmethod
    async def get_for_user(
        db: AsyncSession,
        session_id: uuid.UUID,
    ) -> list[Document]:
        """Return all documents for a given chat session, newest first."""
        from app.models.chat_session import ChatSession  # noqa: PLC0415
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
