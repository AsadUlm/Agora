"""
Document storage providers.

Step 30: pluggable file backend (local disk vs Cloudinary) so deployments
without a persistent disk can still ingest documents.
"""

from app.services.storage.base import (
    DocumentStorageError,
    DocumentStorageService,
    StoredFile,
)
from app.services.storage.factory import get_storage_service

__all__ = [
    "DocumentStorageError",
    "DocumentStorageService",
    "StoredFile",
    "get_storage_service",
]
