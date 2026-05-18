"""
API tests for Step 30 — multi-document upload endpoint.
"""

from __future__ import annotations

from io import BytesIO

import pytest
from httpx import AsyncClient


async def _create_session(client: AsyncClient) -> str:
    resp = await client.post("/sessions", json={"title": "Doc upload test"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_upload_batch_partial_success(client: AsyncClient, tmp_path, monkeypatch):
    # Force local storage in a temp dir so the test doesn't pollute repo root.
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _create_session(client)

    files = [
        ("files", ("good.txt", BytesIO(b"hello world " * 80), "text/plain")),
        ("files", ("data.csv", BytesIO(b"col1,col2\n1,2\n3,4\n"), "text/csv")),
        ("files", ("bad.exe", BytesIO(b"MZ\x00binary"), "application/octet-stream")),
    ]
    resp = await client.post(
        f"/documents/upload-batch?session_id={session_id}",
        files=files,
    )
    assert resp.status_code == 207, resp.text
    body = resp.json()
    uploaded_names = sorted(d["filename"] for d in body["uploaded"])
    failed_names = sorted(f["filename"] for f in body["failed"])
    assert uploaded_names == ["data.csv", "good.txt"]
    assert failed_names == ["bad.exe"]
    # Each successful row carries the storage provider field.
    for row in body["uploaded"]:
        assert row["storage_provider"] == "local"
        assert row["status"] in ("ready", "processing", "failed")

    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_upload_batch_rejects_too_many_files(client: AsyncClient, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.DOCUMENT_MAX_FILES_PER_UPLOAD", 2)
    session_id = await _create_session(client)
    files = [
        ("files", (f"a{i}.txt", BytesIO(b"x"), "text/plain"))
        for i in range(3)
    ]
    resp = await client.post(
        f"/documents/upload-batch?session_id={session_id}",
        files=files,
    )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_upload_batch_rejects_oversize(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.DOCUMENT_MAX_FILE_SIZE_MB", 1)
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _create_session(client)
    huge = BytesIO(b"x" * (2 * 1024 * 1024))  # 2 MB > 1 MB limit
    resp = await client.post(
        f"/documents/upload-batch?session_id={session_id}",
        files=[("files", ("big.txt", huge, "text/plain"))],
    )
    assert resp.status_code == 207
    body = resp.json()
    assert body["uploaded"] == []
    assert len(body["failed"]) == 1
    assert "limit" in body["failed"][0]["error"].lower()

    fac.reset_storage_cache()


@pytest.mark.asyncio
async def test_legacy_single_upload_still_works(
    client: AsyncClient, tmp_path, monkeypatch,
):
    monkeypatch.setattr("app.core.config.settings.UPLOAD_DIR", str(tmp_path))
    from app.services.storage import factory as fac
    fac.reset_storage_cache()

    session_id = await _create_session(client)
    resp = await client.post(
        f"/documents/upload?session_id={session_id}",
        files={"file": ("note.md", BytesIO(b"# heading\n\nbody " * 30), "text/markdown")},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["filename"] == "note.md"
    assert body["storage_provider"] == "local"
    assert body["source_type"] == "md"

    fac.reset_storage_cache()
