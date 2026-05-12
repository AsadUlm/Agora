"""
Cloudinary-backed document storage.

Documents (PDF/DOCX/TXT/CSV/JSON/MD) are stored as ``resource_type='raw'``
under a per-session folder so deletion is straightforward and naming clashes
across sessions are impossible.

The Cloudinary Python SDK is synchronous, so each call is dispatched via
``asyncio.to_thread`` to avoid blocking the event loop.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid

import httpx

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


class CloudinaryDocumentStorage(DocumentStorageService):
    provider_name = "cloudinary"

    def __init__(self) -> None:
        try:
            import cloudinary  # noqa: PLC0415
            import cloudinary.uploader  # noqa: PLC0415, F401 — registers uploader
            import cloudinary.api  # noqa: PLC0415, F401
        except ImportError as exc:
            raise DocumentStorageError(
                "cloudinary package is not installed. Add 'cloudinary' to requirements.txt."
            ) from exc

        cloud_name = settings.CLOUDINARY_CLOUD_NAME
        api_key = settings.CLOUDINARY_API_KEY
        api_secret = settings.CLOUDINARY_API_SECRET
        if not (cloud_name and api_key and api_secret):
            raise DocumentStorageError(
                "Cloudinary credentials are missing. "
                "Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
            )

        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret,
            secure=True,
        )
        self._cloudinary = cloudinary
        self._folder_root = settings.CLOUDINARY_UPLOAD_FOLDER.rstrip("/")
        self._resource_type = settings.CLOUDINARY_RESOURCE_TYPE or "raw"

    # ── helpers ────────────────────────────────────────────────────────────────

    def _public_id(self, document_id: uuid.UUID, filename: str) -> str:
        # Keep the extension on the public_id so Cloudinary preserves format
        # detection on raw downloads.
        return f"{document_id}{_extension(filename)}"

    def _folder(self, session_id: uuid.UUID) -> str:
        return f"{self._folder_root}/{session_id}"

    # ── DocumentStorageService API ────────────────────────────────────────────

    async def upload_bytes(
        self,
        *,
        content: bytes,
        document_id: uuid.UUID,
        session_id: uuid.UUID,
        filename: str,
        content_type: str | None = None,
    ) -> StoredFile:
        public_id = self._public_id(document_id, filename)
        folder = self._folder(session_id)

        def _do_upload() -> dict:
            return self._cloudinary.uploader.upload(
                content,
                resource_type=self._resource_type,
                folder=folder,
                public_id=public_id,
                use_filename=False,
                unique_filename=False,
                overwrite=True,
                context={"original_filename": filename},
            )

        try:
            result = await asyncio.to_thread(_do_upload)
        except Exception as exc:  # noqa: BLE001 — Cloudinary raises various
            raise DocumentStorageError(
                f"Cloudinary upload failed for {filename}: {exc}"
            ) from exc

        stored = StoredFile(
            storage_provider=self.provider_name,
            original_filename=filename,
            public_id=str(result.get("public_id") or f"{folder}/{public_id}"),
            url=result.get("url"),
            secure_url=result.get("secure_url"),
            resource_type=result.get("resource_type") or self._resource_type,
            format=result.get("format") or _extension(filename).lstrip("."),
            bytes=int(result.get("bytes") or len(content)),
            content_type=content_type,
        )
        logger.info(
            "cloudinary_upload_done public_id=%s bytes=%s",
            stored.public_id, stored.bytes,
        )
        return stored

    async def download_bytes(self, stored: StoredFile) -> bytes:
        url = stored.secure_url or stored.url
        if not url:
            raise DocumentStorageError(
                "Cloudinary stored file has no secure_url to download from."
            )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.content
        except httpx.HTTPError as exc:
            raise DocumentStorageError(
                f"Cloudinary download failed for {stored.public_id}: {exc}"
            ) from exc

    async def delete(self, stored: StoredFile) -> None:
        if not stored.public_id:
            return
        public_id = stored.public_id
        resource_type = stored.resource_type or self._resource_type

        def _do_delete() -> dict:
            return self._cloudinary.uploader.destroy(
                public_id,
                resource_type=resource_type,
                invalidate=True,
            )

        try:
            result = await asyncio.to_thread(_do_delete)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "cloudinary_delete_failed public_id=%s reason=%s",
                public_id, exc,
            )
            return
        logger.info(
            "cloudinary_delete_done public_id=%s result=%s",
            public_id, result.get("result") if isinstance(result, dict) else result,
        )
