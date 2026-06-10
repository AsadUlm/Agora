"""
Document routes — upload, list, and delete user documents for RAG grounding.

POST /documents/upload?session_id=<uuid>
    Upload a single file (legacy single-file API).

POST /documents/upload-batch?session_id=<uuid>
    Step 30 — multi-file upload with partial-success semantics.
    Each file is ingested independently; failed files do not abort the batch.

GET  /documents?session_id=<uuid>
    List all documents for a session owned by the current user.

DELETE /documents/{document_id}?session_id=<uuid>
    Delete a document (and cascade-delete its chunks via FK). Also removes
    the underlying file from the configured storage provider (local disk
    or Cloudinary).

Ownership is enforced by verifying the ChatSession.user_id == current_user.id
before any document operation. Users cannot read or modify each other's data.

File size limit: settings.DOCUMENT_MAX_FILE_SIZE_MB (default 20 MB).
Batch limit: settings.DOCUMENT_MAX_FILES_PER_UPLOAD (default 10).
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.chat_session import ChatSession
from app.models.document import Document
from app.models.user import User
from app.schemas.document import (
    DocumentAllItem,
    DocumentDeleteResponse,
    DocumentListItem,
    DocumentUploadBatchResponse,
    DocumentUploadFailure,
    DocumentUploadResponse,
)
from app.services.documents.extractor import (
    extension_from_filename,
    supported_extensions,
)
from app.services.documents.ingestion_service import (
    DocumentIngestionError,
    DocumentIngestionService,
    safe_error_message,
)
from app.services.storage import DocumentStorageError

logger = logging.getLogger(__name__)

router = APIRouter()


def _max_upload_bytes() -> int:
    return int(settings.DOCUMENT_MAX_FILE_SIZE_MB) * 1024 * 1024


# ── Ownership guard ───────────────────────────────────────────────────────────

async def _require_session_ownership(
    session_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> ChatSession:
    """Return the ChatSession if it belongs to the current user, else 403/404."""
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.id == session_id)
        .where(ChatSession.user_id == current_user.id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found or access denied.",
        )
    return session


def _doc_to_response(doc: Document, chunk_count: int | None = None) -> DocumentUploadResponse:
    if chunk_count is None:
        # Populated by the synchronous pipeline; defaults to 0 for legacy rows.
        chunk_count = int(getattr(doc, "_ingest_chunk_count", 0) or 0)
    return DocumentUploadResponse(
        id=doc.id,
        session_id=doc.chat_session_id,
        filename=doc.filename,
        source_type=doc.source_type,
        status=doc.status.value,
        created_at=doc.created_at,
        storage_provider=doc.storage_provider or "local",
        bytes=doc.storage_bytes,
        error_message=doc.error_message,
        chunk_count=chunk_count,
        embedding_status=doc.embedding_status or "pending",
        processed_at=doc.processed_at,
    )


def _sanitize_filename(filename: str | None) -> str:
    """Strip path traversal hints; keep only the basename."""
    raw = filename or "upload"
    # Drop any directory component a malicious client may send.
    base = raw.replace("\\", "/").rsplit("/", 1)[-1]
    return base.strip() or "upload"


def _validate_file_or_raise(filename: str, size: int) -> None:
    ext = extension_from_filename(filename)
    if ext not in supported_extensions():
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{ext}' is not supported. "
                f"Supported: {', '.join(sorted(supported_extensions()))}"
            ),
        )
    if size > _max_upload_bytes():
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File exceeds the {settings.DOCUMENT_MAX_FILE_SIZE_MB} MB limit "
                f"({size} bytes)."
            ),
        )
    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a single document for RAG grounding",
)
async def upload_document(
    session_id: uuid.UUID = Query(..., description="The debate session to attach this document to"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentUploadResponse:
    """Upload a single document and process it synchronously.

    The HTTP response returns only after the document has reached a terminal
    state (``ready`` or ``failed``). Text extraction and chunking run inline;
    embeddings are best-effort and never block readiness. There is no
    background task — a document can never get stuck in ``processing``.
    """
    await _require_session_ownership(session_id, db, current_user)

    filename = _sanitize_filename(file.filename)
    file_bytes = await file.read()
    _validate_file_or_raise(filename, len(file_bytes))

    svc = DocumentIngestionService()
    try:
        doc = await svc.process_upload(
            db=db,
            session_id=session_id,
            filename=filename,
            file_bytes=file_bytes,
            content_type=file.content_type,
        )
    except DocumentIngestionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    response = _doc_to_response(doc)
    await db.commit()
    logger.info(
        "[RAG Upload] done file=%s document=%s status=%s embedding=%s chunks=%d",
        filename, doc.id, doc.status.value, doc.embedding_status, response.chunk_count,
    )
    return response


@router.post(
    "/upload-batch",
    response_model=DocumentUploadBatchResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="Upload multiple documents in one request (partial success)",
)
async def upload_documents_batch(
    session_id: uuid.UUID = Query(..., description="The debate session to attach these documents to"),
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentUploadBatchResponse:
    """
    Ingest a batch of files synchronously with partial-success semantics.

    Each file is validated, then processed end-to-end (extract → chunk →
    store → ready/failed) and committed independently, so one bad file never
    aborts the batch and never rolls back a sibling's success. The response
    returns only once every file has reached a terminal state — there is no
    background task and no permanent ``processing`` state.
    """
    await _require_session_ownership(session_id, db, current_user)

    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No files provided.",
        )
    max_files = int(settings.DOCUMENT_MAX_FILES_PER_UPLOAD)
    if len(files) > max_files:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Too many files in one upload (max {max_files}).",
        )

    logger.info("[RAG Upload] start session=%s files=%d", session_id, len(files))

    svc = DocumentIngestionService()
    uploaded: list[DocumentUploadResponse] = []
    failed: list[DocumentUploadFailure] = []
    max_bytes = _max_upload_bytes()

    for upload in files:
        filename = _sanitize_filename(upload.filename)
        try:
            content = await upload.read()
        except Exception as exc:  # noqa: BLE001
            failed.append(DocumentUploadFailure(filename=filename, error=f"Read failed: {exc}"))
            continue

        # Pre-flight validation, mirroring _validate_file_or_raise but
        # returning per-file errors instead of aborting.
        ext = extension_from_filename(filename)
        if ext not in supported_extensions():
            failed.append(DocumentUploadFailure(
                filename=filename,
                error=f"Unsupported file type '{ext}'.",
            ))
            continue
        if len(content) == 0:
            failed.append(DocumentUploadFailure(filename=filename, error="File is empty."))
            continue
        if len(content) > max_bytes:
            failed.append(DocumentUploadFailure(
                filename=filename,
                error=f"File exceeds {settings.DOCUMENT_MAX_FILE_SIZE_MB} MB limit.",
            ))
            continue

        # Process this file to a terminal state, then commit it on its own so
        # a later file's failure can never roll back this success. ``process_upload``
        # persists processing errors as status=failed (the row is kept and
        # surfaced in the uploaded list); it only raises for unsupported-type /
        # storage failures, which become a per-file ``failed`` entry instead.
        try:
            doc = await svc.process_upload(
                db=db,
                session_id=session_id,
                filename=filename,
                file_bytes=content,
                content_type=upload.content_type,
            )
            response = _doc_to_response(doc)
            await db.commit()
            uploaded.append(response)
            logger.info(
                "[RAG Upload] file=%s document=%s status=%s embedding=%s chunks=%d",
                filename, doc.id, doc.status.value, doc.embedding_status, response.chunk_count,
            )
        except (DocumentIngestionError, DocumentStorageError) as exc:
            await db.rollback()
            logger.warning("[RAG Upload] file=%s rejected reason=%s", filename, exc)
            failed.append(DocumentUploadFailure(filename=filename, error=safe_error_message(exc)))
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            logger.exception("[RAG Upload] file=%s unexpected error", filename)
            failed.append(DocumentUploadFailure(
                filename=filename, error=f"Unexpected error: {safe_error_message(exc)}",
            ))

    ready_count = sum(1 for u in uploaded if u.status == "ready")
    logger.info(
        "[RAG Upload] done session=%s uploaded=%d ready=%d failed=%d",
        session_id, len(uploaded), ready_count, len(failed),
    )
    return DocumentUploadBatchResponse(uploaded=uploaded, failed=failed)


@router.get(
    "/all",
    response_model=list[DocumentAllItem],
    summary="List all documents owned by the current user across all sessions",
)
async def list_all_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentAllItem]:
    """Return all documents for the logged-in user, newest first, with session context."""
    rows = await DocumentIngestionService.get_all_for_user(db, current_user.id)
    return [
        DocumentAllItem(
            id=doc.id,
            session_id=doc.chat_session_id,
            session_title=title,
            filename=doc.filename,
            source_type=doc.source_type,
            status=doc.status.value,
            created_at=doc.created_at,
            storage_provider=doc.storage_provider or "local",
            bytes=doc.storage_bytes,
            storage_url=doc.storage_secure_url if doc.storage_provider == "cloudinary" else None,
        )
        for doc, title in rows
    ]


@router.get(
    "/{document_id}/download",
    summary="Download a document file",
)
async def download_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream the raw file back to the client. Ownership is verified via session user_id."""
    from app.models.chat_session import ChatSession  # noqa: PLC0415
    from sqlalchemy import select as sa_select  # noqa: PLC0415

    # Look up the doc and verify it belongs to the current user.
    result = await db.execute(
        sa_select(Document)
        .join(ChatSession, Document.chat_session_id == ChatSession.id)
        .where(Document.id == document_id)
        .where(ChatSession.user_id == current_user.id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    from urllib.parse import quote  # noqa: PLC0415
    encoded_name = quote(doc.filename, safe="")
    disposition = f"inline; filename*=UTF-8''{encoded_name}"
    content_type = doc.content_type or "application/octet-stream"

    if doc.storage_provider == "cloudinary" and doc.storage_secure_url:
        # Proxy through our server — Cloudinary raw uploads are not publicly
        # accessible, so a direct redirect returns 401 in the browser.
        import httpx  # noqa: PLC0415
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(doc.storage_secure_url)
                resp.raise_for_status()
                file_bytes = resp.content
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not fetch file from storage: {exc}",
            ) from exc
        return StreamingResponse(
            iter([file_bytes]),
            media_type=content_type,
            headers={"Content-Disposition": disposition},
        )

    # Local storage — read and stream the bytes.
    if not doc.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk.")

    from pathlib import Path  # noqa: PLC0415
    path = Path(doc.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk.")

    file_bytes = path.read_bytes()
    return StreamingResponse(
        iter([file_bytes]),
        media_type=content_type,
        headers={"Content-Disposition": disposition},
    )


@router.get(
    "",
    response_model=list[DocumentListItem],
    summary="List documents for a session",
)
async def list_documents(
    session_id: uuid.UUID = Query(..., description="Filter documents by session"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentListItem]:
    """Return all documents for the given session, newest first.

    Self-healing: any document stuck in ``processing`` past the configured
    timeout (its background task died / never ran) is flipped to ``failed``
    here, so the frontend poller never observes an infinite spinner.
    """
    await _require_session_ownership(session_id, db, current_user)

    await DocumentIngestionService.recover_stale_processing(db, session_id)

    docs = await DocumentIngestionService.get_for_user(db, session_id)

    # One grouped query for chunk counts — avoids an N+1 over documents.
    from sqlalchemy import func  # noqa: PLC0415
    from app.models.document_chunk import DocumentChunk  # noqa: PLC0415

    chunk_counts: dict[uuid.UUID, int] = {}
    if docs:
        rows = await db.execute(
            select(DocumentChunk.document_id, func.count(DocumentChunk.id))
            .where(DocumentChunk.document_id.in_([d.id for d in docs]))
            .group_by(DocumentChunk.document_id)
        )
        chunk_counts = {doc_id: int(count) for doc_id, count in rows.all()}

    return [
        DocumentListItem(
            id=d.id,
            session_id=d.chat_session_id,
            filename=d.filename,
            source_type=d.source_type,
            status=d.status.value,
            created_at=d.created_at,
            storage_provider=d.storage_provider or "local",
            bytes=d.storage_bytes,
            error_message=d.error_message,
            chunk_count=chunk_counts.get(d.id, 0),
            embedding_status=d.embedding_status or "pending",
            processing_started_at=d.processing_started_at,
            processed_at=d.processed_at,
        )
        for d in docs
    ]


@router.get(
    "/rag-health",
    summary="Diagnostic snapshot of the RAG pipeline for a session",
)
async def rag_health(
    session_id: uuid.UUID = Query(..., description="Session to inspect"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Returns provider/model/dim plus chunk-embedding statistics for the
    session. Ownership-protected. Never returns chunk content or any
    secret material.
    """
    await _require_session_ownership(session_id, db, current_user)

    # Lazy imports — keep module import cost low for unrelated routes.
    from sqlalchemy import func  # noqa: PLC0415
    from app.models.document import DocumentStatus  # noqa: PLC0415
    from app.models.document_chunk import DocumentChunk  # noqa: PLC0415
    from app.services.embeddings.embedding_service import (  # noqa: PLC0415
        EmbeddingProviderError,
        MockEmbeddingService,
        get_embedding_service,
    )

    provider_name: str
    provider_error: str | None = None
    is_mock = False
    try:
        svc = get_embedding_service()
        provider_name = type(svc).__name__
        is_mock = isinstance(svc, MockEmbeddingService)
    except EmbeddingProviderError as exc:
        provider_name = "UNAVAILABLE"
        provider_error = str(exc)

    # Chunk-side stats scoped to this session.
    base = (
        select(func.count(DocumentChunk.id))
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(Document.chat_session_id == session_id)
    )
    total_chunks = (await db.execute(base)).scalar() or 0
    null_chunks = (
        await db.execute(base.where(DocumentChunk.embedding.is_(None)))
    ).scalar() or 0
    total_docs = (
        await db.execute(
            select(func.count(Document.id)).where(Document.chat_session_id == session_id)
        )
    ).scalar() or 0
    ready_docs = (
        await db.execute(
            select(func.count(Document.id))
            .where(Document.chat_session_id == session_id)
            .where(Document.status == DocumentStatus.ready)
        )
    ).scalar() or 0

    # Sample a handful of stored vectors to detect all-zero embeddings without
    # streaming everything.
    sample_stmt = (
        select(DocumentChunk.embedding)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(Document.chat_session_id == session_id)
        .where(DocumentChunk.embedding.is_not(None))
        .limit(10)
    )
    sample_total = 0
    sample_zero = 0
    try:
        for vec in (await db.execute(sample_stmt)).scalars().all():
            sample_total += 1
            if vec is not None and all(abs(float(v)) < 1e-9 for v in vec):
                sample_zero += 1
    except Exception:  # pragma: no cover — defensive
        sample_total = -1
        sample_zero = -1

    return {
        "provider": provider_name,
        "is_mock": is_mock,
        "provider_error": provider_error,
        "model": settings.EMBEDDING_MODEL,
        "dim": settings.EMBEDDING_DIM,
        "session_id": str(session_id),
        "document_count": int(total_docs),
        "ready_document_count": int(ready_docs),
        "chunk_count": int(total_chunks),
        "null_embedding_chunk_count": int(null_chunks),
        "sampled_chunks": sample_total,
        "zero_embedding_in_sample": sample_zero,
    }


@router.delete(
    "/{document_id}",
    response_model=DocumentDeleteResponse,
    summary="Delete a document",
)
async def delete_document(
    document_id: uuid.UUID,
    session_id: uuid.UUID = Query(..., description="Session that owns this document"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentDeleteResponse:
    """
    Delete a document and all its associated chunks.
    The cascade FK in the DB handles chunk deletion automatically.
    """
    await _require_session_ownership(session_id, db, current_user)

    doc = await DocumentIngestionService.get_by_id(db, document_id, session_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document {document_id} not found.",
        )

    logger.info("document_delete_start document=%s provider=%s", doc.id, doc.storage_provider)

    # Best-effort: remove the underlying blob via the provider that wrote it.
    # If the active provider differs (e.g. switched config), still try the
    # row's recorded provider so we don't leak Cloudinary objects.
    try:
        from app.services.storage import get_storage_service  # noqa: PLC0415
        from app.services.storage.local import LocalDocumentStorage  # noqa: PLC0415

        provider_name = (doc.storage_provider or "local").lower()
        if provider_name == "cloudinary":
            try:
                from app.services.storage.cloudinary_provider import (  # noqa: PLC0415
                    CloudinaryDocumentStorage,
                )
                provider = CloudinaryDocumentStorage()
            except DocumentStorageError as exc:
                logger.warning(
                    "document_delete: cloudinary unavailable (%s) — orphan public_id=%s",
                    exc, doc.storage_public_id,
                )
                provider = None
        else:
            provider = LocalDocumentStorage()

        if provider is not None:
            stored = DocumentIngestionService.stored_file_from_doc(doc)
            await provider.delete(stored)
        # Touch get_storage_service to keep cache warm if we ever need it later.
        _ = get_storage_service
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "document_delete: storage delete failed document=%s reason=%s",
            doc.id, exc,
        )

    await db.delete(doc)
    return DocumentDeleteResponse(id=document_id, deleted=True)

