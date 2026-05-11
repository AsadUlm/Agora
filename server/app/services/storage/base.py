"""
Storage abstraction for document files.

Step 30: introduces ``DocumentStorageService`` so ingestion no longer needs to
know whether bytes live on local disk or in Cloudinary. Each provider returns a
``StoredFile`` describing where/how the bytes live; ``download_bytes`` fetches
them back so the extractor can run on bytes regardless of provider.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass


class DocumentStorageError(Exception):
    """Raised when a storage operation (upload / download / delete) fails."""


@dataclass
class StoredFile:
    """
    Description of a file as persisted by a storage provider.

    Local provider populates ``local_path``. Cloudinary populates
    ``public_id`` / ``secure_url`` / ``url``. ``bytes`` and ``content_type``
    are best-effort metadata used for logging and downloads.
    """

    storage_provider: str           # "local" | "cloudinary"
    original_filename: str
    public_id: str | None = None
    url: str | None = None
    secure_url: str | None = None
    resource_type: str | None = None
    format: str | None = None
    bytes: int | None = None
    content_type: str | None = None
    local_path: str | None = None


class DocumentStorageService(ABC):
    """Abstract base for document blob storage providers."""

    provider_name: str = "abstract"

    @abstractmethod
    async def upload_bytes(
        self,
        *,
        content: bytes,
        document_id: uuid.UUID,
        session_id: uuid.UUID,
        filename: str,
        content_type: str | None = None,
    ) -> StoredFile:
        """Persist ``content`` and return a ``StoredFile`` handle."""

    @abstractmethod
    async def download_bytes(self, stored: StoredFile) -> bytes:
        """Fetch the raw bytes back. Used by the extractor when needed."""

    @abstractmethod
    async def delete(self, stored: StoredFile) -> None:
        """Remove the file from storage. Must not raise on missing files."""
