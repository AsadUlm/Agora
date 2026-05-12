"""
Tests for Step 30 — DocumentStorageService and the multi-format extractor.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.services.documents.extractor import (
    ExtractionError,
    extract_text,
    supported_extensions,
)
from app.services.storage.base import DocumentStorageError, StoredFile
from app.services.storage.local import LocalDocumentStorage


# ─────────────────────────────────────────────────────────────────────────────
# Extractor — new formats
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractor:
    def test_supported_extensions_includes_step30_formats(self):
        ext = supported_extensions()
        assert ".txt" in ext
        assert ".md" in ext
        assert ".pdf" in ext
        assert ".docx" in ext
        assert ".csv" in ext
        assert ".json" in ext

    def test_extract_md(self):
        text = extract_text(b"# Title\n\nBody text.", "notes.md")
        assert "Title" in text
        assert "Body text" in text

    def test_extract_csv_with_headers(self):
        csv_bytes = b"name,age,city\nAlice,30,Paris\nBob,25,Berlin\n"
        text = extract_text(csv_bytes, "people.csv")
        assert "Columns: name, age, city" in text
        assert "name: Alice" in text
        assert "city: Berlin" in text

    def test_extract_csv_empty_raises(self):
        with pytest.raises(ExtractionError):
            extract_text(b"", "empty.csv")

    def test_extract_json_pretty_prints(self):
        text = extract_text(b'{"a": 1, "nested": {"b": [1,2,3]}}', "data.json")
        assert '"a": 1' in text
        assert '"nested"' in text

    def test_extract_json_invalid_raises(self):
        with pytest.raises(ExtractionError, match="JSON is invalid"):
            extract_text(b"{not valid", "broken.json")

    def test_unsupported_extension_raises(self):
        with pytest.raises(ExtractionError, match="not supported"):
            extract_text(b"x", "thing.exe")


# ─────────────────────────────────────────────────────────────────────────────
# Local storage provider
# ─────────────────────────────────────────────────────────────────────────────

class TestLocalStorage:
    @pytest.mark.asyncio
    async def test_upload_download_delete_roundtrip(self, tmp_path: Path):
        storage = LocalDocumentStorage(upload_dir=str(tmp_path))
        doc_id = uuid.uuid4()
        session_id = uuid.uuid4()

        stored = await storage.upload_bytes(
            content=b"hello world",
            document_id=doc_id,
            session_id=session_id,
            filename="greeting.txt",
            content_type="text/plain",
        )
        assert stored.storage_provider == "local"
        assert stored.local_path
        assert Path(stored.local_path).exists()
        assert stored.bytes == len(b"hello world")
        assert stored.format == "txt"

        content = await storage.download_bytes(stored)
        assert content == b"hello world"

        await storage.delete(stored)
        assert not Path(stored.local_path).exists()

    @pytest.mark.asyncio
    async def test_delete_missing_file_is_silent(self, tmp_path: Path):
        storage = LocalDocumentStorage(upload_dir=str(tmp_path))
        stored = StoredFile(
            storage_provider="local",
            original_filename="ghost.txt",
            local_path=str(tmp_path / "does_not_exist.txt"),
        )
        # Should not raise
        await storage.delete(stored)

    @pytest.mark.asyncio
    async def test_download_without_local_path_raises(self):
        storage = LocalDocumentStorage()
        stored = StoredFile(storage_provider="local", original_filename="x.txt")
        with pytest.raises(DocumentStorageError):
            await storage.download_bytes(stored)


# ─────────────────────────────────────────────────────────────────────────────
# Cloudinary provider — config errors only (no network calls in unit tests)
# ─────────────────────────────────────────────────────────────────────────────

class TestCloudinaryProviderConfig:
    def test_missing_credentials_raises(self, monkeypatch):
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_CLOUD_NAME", None)
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_API_KEY", None)
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_API_SECRET", None)
        from app.services.storage.cloudinary_provider import CloudinaryDocumentStorage
        with pytest.raises(DocumentStorageError, match="Cloudinary credentials"):
            CloudinaryDocumentStorage()


# ─────────────────────────────────────────────────────────────────────────────
# Storage factory
# ─────────────────────────────────────────────────────────────────────────────

class TestStorageFactory:
    def test_default_is_local(self, monkeypatch):
        from app.services.storage import factory as fac
        monkeypatch.setattr("app.core.config.settings.DOCUMENT_STORAGE_PROVIDER", "local")
        fac.reset_storage_cache()
        svc = fac.get_storage_service()
        assert svc.provider_name == "local"
        fac.reset_storage_cache()

    def test_unknown_provider_falls_back_to_local(self, monkeypatch):
        from app.services.storage import factory as fac
        monkeypatch.setattr(
            "app.core.config.settings.DOCUMENT_STORAGE_PROVIDER", "s3-imaginary",
        )
        fac.reset_storage_cache()
        svc = fac.get_storage_service()
        assert svc.provider_name == "local"
        fac.reset_storage_cache()

    def test_cloudinary_without_creds_falls_back_to_local(self, monkeypatch):
        from app.services.storage import factory as fac
        monkeypatch.setattr(
            "app.core.config.settings.DOCUMENT_STORAGE_PROVIDER", "cloudinary",
        )
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_CLOUD_NAME", None)
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_API_KEY", None)
        monkeypatch.setattr("app.core.config.settings.CLOUDINARY_API_SECRET", None)
        fac.reset_storage_cache()
        svc = fac.get_storage_service()
        # Init failed → fall back to local
        assert svc.provider_name == "local"
        fac.reset_storage_cache()
