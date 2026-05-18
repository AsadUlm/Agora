"""
Local-disk storage provider — keeps the legacy ``UPLOAD_DIR`` behaviour so dev
and tests continue to work without Cloudinary credentials.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

from app.core.config import settings
from app.services.storage.base import (
    DocumentStorageError,
    DocumentStorageService,
    StoredFile,
)

logger = logging.getLogger(__name__)


def _extension(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext.lower()


class LocalDocumentStorage(DocumentStorageService):
    provider_name = "local"

    def __init__(self, upload_dir: str | None = None) -> None:
        self._upload_dir = Path(upload_dir or settings.UPLOAD_DIR)

    def _path_for(self, document_id: uuid.UUID, filename: str) -> Path:
        self._upload_dir.mkdir(parents=True, exist_ok=True)
        return self._upload_dir / f"{document_id}{_extension(filename)}"

    async def upload_bytes(
        self,
        *,
        content: bytes,
        document_id: uuid.UUID,
        session_id: uuid.UUID,  # noqa: ARG002 — kept for API parity
        filename: str,
        content_type: str | None = None,
    ) -> StoredFile:
        path = self._path_for(document_id, filename)
        try:
            path.write_bytes(content)
        except OSError as exc:
            raise DocumentStorageError(f"Failed to write {path}: {exc}") from exc
        return StoredFile(
            storage_provider=self.provider_name,
            original_filename=filename,
            local_path=str(path),
            bytes=len(content),
            content_type=content_type,
            format=_extension(filename).lstrip("."),
            resource_type="raw",
        )

    async def download_bytes(self, stored: StoredFile) -> bytes:
        if not stored.local_path:
            raise DocumentStorageError("Local stored file has no local_path.")
        try:
            return Path(stored.local_path).read_bytes()
        except OSError as exc:
            raise DocumentStorageError(
                f"Failed to read {stored.local_path}: {exc}"
            ) from exc

    async def delete(self, stored: StoredFile) -> None:
        if not stored.local_path:
            return
        try:
            os.remove(stored.local_path)
        except FileNotFoundError:
            return
        except OSError as exc:
            logger.warning(
                "local storage: failed to delete %s: %s",
                stored.local_path, exc,
            )
