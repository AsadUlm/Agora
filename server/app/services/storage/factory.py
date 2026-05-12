"""
Storage provider factory.

Selects the active provider via ``settings.DOCUMENT_STORAGE_PROVIDER``.
The instance is cached per-process so Cloudinary config runs only once.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from app.core.config import settings
from app.services.storage.base import (
    DocumentStorageError,
    DocumentStorageService,
)
from app.services.storage.local import LocalDocumentStorage

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _build_service() -> DocumentStorageService:
    provider = (settings.DOCUMENT_STORAGE_PROVIDER or "local").lower().strip()

    if provider == "cloudinary":
        from app.services.storage.cloudinary_provider import (  # noqa: PLC0415
            CloudinaryDocumentStorage,
        )
        try:
            svc = CloudinaryDocumentStorage()
            logger.info("document storage: cloudinary provider active")
            return svc
        except DocumentStorageError as exc:
            logger.error(
                "document storage: cloudinary init failed (%s) — falling back to local",
                exc,
            )
            return LocalDocumentStorage()

    if provider != "local":
        logger.warning(
            "document storage: unknown provider %r, defaulting to local",
            provider,
        )
    return LocalDocumentStorage()


def get_storage_service() -> DocumentStorageService:
    """Return the configured storage provider (cached)."""
    return _build_service()


def reset_storage_cache() -> None:
    """Test-only helper to clear the cached provider."""
    _build_service.cache_clear()
