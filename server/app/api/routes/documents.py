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


def _doc_to_response(doc: Document) -> DocumentUploadResponse:
    return DocumentUploadResponse(
        id=doc.id,
        session_id=doc.chat_session_id,
        filename=doc.filename,
        source_type=doc.source_type,
        status=doc.status.value,
        created_at=doc.created_at,
        storage_provider=doc.storage_provider or "local",
        bytes=doc.storage_bytes,
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
    """Upload and ingest a single document (legacy single-file endpoint)."""
    await _require_session_ownership(session_id, db, current_user)

    filename = _sanitize_filename(file.filename)
    file_bytes = await file.read()
    _validate_file_or_raise(filename, len(file_bytes))

    svc = DocumentIngestionService()
    try:
        doc = await svc.ingest(
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

    return _doc_to_response(doc)


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
    Step 30: ingest a batch of files. One bad file does not fail the batch.

    For every file we validate the extension/size, run the full ingestion
    pipeline, and roll back its DB rows + delete the storage blob if any
    later step fails.
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

        # Use a SAVEPOINT so a failed file rolls back its own rows but the
        # successful files in the batch remain persisted.
        try:
            async with db.begin_nested():
                doc = await svc.ingest(
                    db=db,
                    session_id=session_id,
                    filename=filename,
                    file_bytes=content,
                    content_type=upload.content_type,
                )
            uploaded.append(_doc_to_response(doc))
        except DocumentIngestionError as exc:
            logger.warning(
                "document_upload_failed filename=%s reason=%s",
                filename, exc,
            )
            failed.append(DocumentUploadFailure(filename=filename, error=str(exc)))
        except DocumentStorageError as exc:
            logger.warning(
                "document_upload_failed filename=%s reason=storage:%s",
                filename, exc,
            )
            failed.append(DocumentUploadFailure(
                filename=filename, error=f"Storage failure: {exc}",
            ))
        except Exception as exc:  # noqa: BLE001
            logger.exception("document_upload_failed filename=%s", filename)
            failed.append(DocumentUploadFailure(
                filename=filename, error=f"Unexpected error: {exc}",
            ))

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
    """Return all documents for the given session, newest first."""
    await _require_session_ownership(session_id, db, current_user)
    docs = await DocumentIngestionService.get_for_user(db, session_id)
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
        )
        for d in docs
    ]


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

