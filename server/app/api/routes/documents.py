"""
Document routes — upload, list, and delete user documents for RAG grounding.

POST /documents/upload?session_id=<uuid>
    Upload a file and run the full ingestion pipeline (extract → chunk → embed).
    The file must belong to a session owned by the current user.
    Supported types: .txt, .pdf, .docx

GET  /documents?session_id=<uuid>
    List all documents for a session owned by the current user.

DELETE /documents/{document_id}?session_id=<uuid>
    Delete a document (and cascade-delete its chunks via FK).

Ownership is enforced by verifying the ChatSession.user_id == current_user.id
before any document operation.  Users cannot read or modify each other's data.

File size limit: 20 MB (enforced by FastAPI's UploadFile read + explicit check).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.chat_session import ChatSession
from app.models.document import Document
from app.models.user import User
from app.schemas.document import (
    DocumentDeleteResponse,
    DocumentListItem,
    DocumentUploadResponse,
)
from app.services.documents.ingestion_service import (
    DocumentIngestionError,
    DocumentIngestionService,
)
from app.services.documents.extractor import supported_extensions

router = APIRouter()

_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB


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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document for RAG grounding",
)
async def upload_document(
    session_id: uuid.UUID = Query(..., description="The debate session to attach this document to"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentUploadResponse:
    """
    Upload and ingest a document.

    The pipeline runs synchronously (inline) — for typical documents (< 20 MB)
    this completes in under a second with the mock embedder, or 2-5 seconds with
    the OpenAI embedder depending on chunk count.

    Supported file types: .txt, .pdf, .docx
    """
    await _require_session_ownership(session_id, db, current_user)

    # Validate extension before reading the whole body
    filename = file.filename or "upload"
    from app.services.documents.extractor import extension_from_filename  # noqa: PLC0415
    ext = extension_from_filename(filename)
    if ext not in supported_extensions():
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"File type '{ext}' is not supported. "
                f"Supported: {', '.join(sorted(supported_extensions()))}"
            ),
        )

    file_bytes = await file.read()
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the 20 MB limit ({len(file_bytes)} bytes).",
        )
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty.",
        )

    svc = DocumentIngestionService()
    try:
        doc = await svc.ingest(
            db=db,
            session_id=session_id,
            filename=filename,
            file_bytes=file_bytes,
        )
    except DocumentIngestionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return DocumentUploadResponse(
        id=doc.id,
        session_id=doc.chat_session_id,
        filename=doc.filename,
        source_type=doc.source_type,
        status=doc.status.value,
        created_at=doc.created_at,
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

    # Remove file from disk if it exists
    import os  # noqa: PLC0415
    if doc.file_path:
        try:
            os.remove(doc.file_path)
        except OSError:
            pass  # file already gone — not fatal

    await db.delete(doc)
    return DocumentDeleteResponse(id=document_id, deleted=True)
