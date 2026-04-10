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


class DocumentListItem(BaseModel):
    """One item in the GET /documents response list."""

    id: uuid.UUID
    session_id: uuid.UUID
    filename: str
    source_type: str
    status: str
    created_at: datetime


class DocumentDeleteResponse(BaseModel):
    id: uuid.UUID
    deleted: bool
