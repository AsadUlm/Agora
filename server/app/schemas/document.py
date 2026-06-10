"""
Document API schemas — request/response DTOs for the /documents endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentUploadResponse(BaseModel):
    """Response from POST /documents/upload.

    Since processing is synchronous, ``status`` is always terminal
    (``ready`` | ``failed``) by the time this is returned — never
    ``processing``. ``chunk_count`` confirms how many searchable chunks were
    stored; ``embedding_status`` reports whether semantic vectors are available
    (retrieval falls back to keyword search when they are not).
    """

    id: uuid.UUID
    session_id: uuid.UUID
    filename: str
    source_type: str
    status: str  # ready | failed (processing only transiently, never returned)
    created_at: datetime
    storage_provider: str = "local"
    bytes: int | None = None
    error_message: str | None = None
    chunk_count: int = 0
    # pending | ready | failed | disabled
    embedding_status: str = "pending"
    processed_at: datetime | None = None


class DocumentListItem(BaseModel):
    """One item in the GET /documents response list."""

    id: uuid.UUID
    session_id: uuid.UUID
    filename: str
    source_type: str
    status: str
    created_at: datetime
    storage_provider: str = "local"
    bytes: int | None = None
    error_message: str | None = None
    # Number of searchable chunks persisted for this document. > 0 confirms the
    # document is retrievable (via vector search or keyword fallback).
    chunk_count: int = 0
    # pending | ready | failed | disabled — embedding lifecycle, independent of
    # ``status``. A document is ``ready`` even when embeddings are failed/disabled.
    embedding_status: str = "pending"
    processing_started_at: datetime | None = None
    processed_at: datetime | None = None


class DocumentDeleteResponse(BaseModel):
    id: uuid.UUID
    deleted: bool


class DocumentAllItem(BaseModel):
    """One item in the GET /documents/all response — includes session context."""

    id: uuid.UUID
    session_id: uuid.UUID
    session_title: str | None
    filename: str
    source_type: str
    status: str
    created_at: datetime
    storage_provider: str = "local"
    bytes: int | None = None
    # Direct URL for cloudinary docs; None for local (use /download endpoint)
    storage_url: str | None = None


# ── Step 30: multi-upload batch response ────────────────────────────────────

class DocumentUploadFailure(BaseModel):
    """One file that could not be ingested in a batch upload."""

    filename: str
    error: str


class DocumentUploadBatchResponse(BaseModel):
    """Partial-success response from POST /documents/upload-batch."""

    uploaded: list[DocumentUploadResponse] = []
    failed: list[DocumentUploadFailure] = []

