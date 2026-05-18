"""
Document API schemas — request/response DTOs for the /documents endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentUploadResponse(BaseModel):
    """Response from POST /documents/upload."""

    id: uuid.UUID
    session_id: uuid.UUID
    filename: str
    source_type: str
    status: str  # uploaded | processing | ready | failed
    created_at: datetime
    storage_provider: str = "local"
    bytes: int | None = None


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

