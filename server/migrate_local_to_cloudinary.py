"""
One-time migration: local document storage → Cloudinary.

Finds all Document rows where storage_provider = 'local', reads each file
from UPLOAD_DIR, uploads to Cloudinary, then updates the DB row in place.

Usage (from the server/ directory):
    python migrate_local_to_cloudinary.py [--dry-run]

Flags:
    --dry-run   Print what would be migrated without uploading or writing to DB.
"""

import argparse
import asyncio
import mimetypes
import os
import sys
import uuid
from pathlib import Path

# ── bootstrap the app environment ─────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from app.core.config import settings
import cloudinary
import cloudinary.uploader

cloudinary.config(
    cloud_name=settings.CLOUDINARY_CLOUD_NAME,
    api_key=settings.CLOUDINARY_API_KEY,
    api_secret=settings.CLOUDINARY_API_SECRET,
    secure=True,
)

FOLDER_ROOT = (settings.CLOUDINARY_UPLOAD_FOLDER or "agora/documents").rstrip("/")
RESOURCE_TYPE = settings.CLOUDINARY_RESOURCE_TYPE or "raw"
UPLOAD_DIR = Path(settings.UPLOAD_DIR)


def _extension(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext.lower()


def _public_id(document_id: uuid.UUID, filename: str) -> str:
    return f"{document_id}{_extension(filename)}"


def _folder(session_id: uuid.UUID) -> str:
    return f"{FOLDER_ROOT}/{session_id}"


async def run(dry_run: bool) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models.document import Document, DocumentStatus

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Document).where(Document.storage_provider == "local")
        )
        docs = result.scalars().all()

    print(f"Found {len(docs)} local document(s) to migrate.")
    if not docs:
        print("Nothing to do.")
        return

    migrated = 0
    skipped = 0
    failed = 0

    async with AsyncSessionLocal() as db:
        for doc in docs:
            # Resolve the on-disk path
            local_path: Path | None = None
            if doc.file_path:
                candidate = Path(doc.file_path)
                if not candidate.is_absolute():
                    candidate = UPLOAD_DIR / candidate
                if candidate.exists():
                    local_path = candidate

            # Fallback: look for <document_id>.<ext> directly in UPLOAD_DIR
            if local_path is None:
                for p in UPLOAD_DIR.glob(f"{doc.id}*"):
                    if p.is_file():
                        local_path = p
                        break

            if local_path is None:
                print(f"  [SKIP] {doc.id} ({doc.filename}) — file not found on disk")
                skipped += 1
                continue

            if dry_run:
                folder = _folder(doc.chat_session_id)
                pub_id = _public_id(doc.id, doc.filename)
                print(f"  [DRY]  {doc.id} ({doc.filename}) → {folder}/{pub_id}")
                migrated += 1
                continue

            # Upload
            try:
                content = local_path.read_bytes()
                content_type, _ = mimetypes.guess_type(doc.filename or str(local_path))
                folder = _folder(doc.chat_session_id)
                pub_id = _public_id(doc.id, doc.filename)

                upload_result = cloudinary.uploader.upload(
                    content,
                    resource_type=RESOURCE_TYPE,
                    folder=folder,
                    public_id=pub_id,
                    use_filename=False,
                    unique_filename=False,
                    overwrite=True,
                    context={"original_filename": doc.filename},
                )

                # Update DB row
                doc.storage_provider = "cloudinary"
                doc.storage_public_id = str(
                    upload_result.get("public_id") or f"{folder}/{pub_id}"
                )
                doc.storage_url = upload_result.get("url")
                doc.storage_secure_url = upload_result.get("secure_url")
                doc.storage_resource_type = upload_result.get("resource_type") or RESOURCE_TYPE
                doc.storage_format = upload_result.get("format") or _extension(doc.filename).lstrip(".")
                doc.storage_bytes = int(upload_result.get("bytes") or len(content))
                db.add(doc)
                await db.flush()

                print(f"  [OK]   {doc.id} ({doc.filename}) → {doc.storage_public_id}")
                migrated += 1

            except Exception as exc:  # noqa: BLE001
                print(f"  [FAIL] {doc.id} ({doc.filename}) — {exc}")
                failed += 1

        if not dry_run:
            await db.commit()

    print()
    if dry_run:
        print(f"Dry run complete. Would migrate: {migrated}, skip: {skipped}.")
    else:
        print(f"Migration complete. Migrated: {migrated}, skipped: {skipped}, failed: {failed}.")
        if failed:
            print("Re-run the script to retry failed files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate local docs to Cloudinary.")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no changes.")
    args = parser.parse_args()

    asyncio.run(run(dry_run=args.dry_run))
