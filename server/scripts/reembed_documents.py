"""
Re-embed document chunks with the current EmbeddingService.

Use cases:
  • You changed EMBEDDING_PROVIDER from "mock" to a real provider — all the
    old chunks have zero vectors and must be re-embedded.
  • You changed EMBEDDING_MODEL or EMBEDDING_DIM — old vectors are stale.
  • A batch ingestion failed half-way and some chunks ended up with NULL
    embeddings.

Examples (run from the ``server/`` directory):

    # Re-embed only the chunks that have zero vectors or NULL embeddings,
    # across every document in the database:
    python -m scripts.reembed_documents --only-zero-vectors

    # Re-embed all chunks for one specific session:
    python -m scripts.reembed_documents --session-id 8e3c...

    # Re-embed a single document:
    python -m scripts.reembed_documents --document-id 4f1a...

    # Dry-run to count what would be touched, without calling the API:
    python -m scripts.reembed_documents --only-zero-vectors --dry-run

Safety:
  • Reads chunks in batches, embeds with the singleton EmbeddingService,
    writes back per-batch — a failure half-way through leaves earlier
    batches committed.
  • Never prints API keys or full vectors.
  • Skips chunks whose content is empty.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import uuid
from pathlib import Path
from typing import Iterable

# Allow running as `python scripts/reembed_documents.py` from the server dir.
_HERE = Path(__file__).resolve().parent
_SERVER_ROOT = _HERE.parent
if str(_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVER_ROOT))

from sqlalchemy import func, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.document import Document  # noqa: E402
from app.models.document_chunk import DocumentChunk  # noqa: E402
from app.services.embeddings.embedding_service import (  # noqa: E402
    EMBEDDING_DIM,
    EmbeddingProviderError,
    get_embedding_service,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
)
logger = logging.getLogger("reembed")


_ZERO_EPS = 1e-9


def _is_zero_or_invalid(vector) -> bool:
    """True when a stored vector is missing, wrong dim, or all-zero."""
    if vector is None:
        return True
    try:
        if len(vector) != EMBEDDING_DIM:
            return True
        return all(abs(float(v)) < _ZERO_EPS for v in vector)
    except (TypeError, ValueError):
        return True


def _chunked(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


async def _select_target_chunks(
    db,
    *,
    session_id: uuid.UUID | None,
    document_id: uuid.UUID | None,
    only_zero: bool,
) -> list[DocumentChunk]:
    stmt = select(DocumentChunk)
    if document_id is not None:
        stmt = stmt.where(DocumentChunk.document_id == document_id)
    elif session_id is not None:
        stmt = stmt.join(Document, Document.id == DocumentChunk.document_id).where(
            Document.chat_session_id == session_id
        )
    stmt = stmt.order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
    rows = await db.execute(stmt)
    chunks = list(rows.scalars().all())
    if only_zero:
        chunks = [c for c in chunks if _is_zero_or_invalid(c.embedding)]
    return chunks


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--session-id", type=str, help="Limit to one chat session.")
    scope.add_argument("--document-id", type=str, help="Limit to one document.")
    parser.add_argument(
        "--only-zero-vectors",
        action="store_true",
        help="Skip chunks whose embedding already looks valid (non-zero, correct dim).",
    )
    parser.add_argument("--batch-size", type=int, default=32, help="Chunks per embed call (default 32).")
    parser.add_argument("--dry-run", action="store_true", help="Count what would be done, don't call the API.")
    args = parser.parse_args()

    session_id = uuid.UUID(args.session_id) if args.session_id else None
    document_id = uuid.UUID(args.document_id) if args.document_id else None

    try:
        embed = get_embedding_service()
    except EmbeddingProviderError as exc:
        logger.error("Embedding service misconfigured: %s", exc)
        return 2

    provider_name = type(embed).__name__
    if provider_name == "MockEmbeddingService" and not args.dry_run:
        logger.error(
            "Refusing to re-embed with MockEmbeddingService — that would "
            "overwrite real vectors with zeros. Set EMBEDDING_PROVIDER to a "
            "real provider (e.g. openrouter) before running."
        )
        return 2

    logger.info(
        "Using provider=%s model=%s dim=%d batch_size=%d dry_run=%s",
        provider_name,
        settings.EMBEDDING_MODEL,
        EMBEDDING_DIM,
        args.batch_size,
        args.dry_run,
    )

    total = updated = skipped = failed = 0

    async with AsyncSessionLocal() as db:
        chunks = await _select_target_chunks(
            db,
            session_id=session_id,
            document_id=document_id,
            only_zero=args.only_zero_vectors,
        )
        total = len(chunks)
        logger.info("Selected %d chunk(s) for re-embedding.", total)

        if args.dry_run or total == 0:
            logger.info("Dry-run / nothing to do — exiting.")
            return 0

        for batch_idx, batch in enumerate(_chunked(chunks, args.batch_size), start=1):
            texts = [c.content or "" for c in batch]
            non_empty = [i for i, t in enumerate(texts) if t.strip()]
            if not non_empty:
                skipped += len(batch)
                continue
            try:
                vectors = await embed.embed_batch([texts[i] for i in non_empty])
            except Exception as exc:
                failed += len(batch)
                logger.warning("Batch %d failed: %s", batch_idx, exc)
                continue
            if len(vectors) != len(non_empty):
                failed += len(batch)
                logger.warning(
                    "Batch %d returned %d vectors for %d inputs — skipping",
                    batch_idx, len(vectors), len(non_empty),
                )
                continue
            for local_idx, vec in zip(non_empty, vectors):
                batch[local_idx].embedding = vec
                updated += 1
            skipped += len(batch) - len(non_empty)
            await db.commit()
            logger.info(
                "Batch %d: updated=%d skipped_empty=%d (running total updated=%d)",
                batch_idx, len(non_empty), len(batch) - len(non_empty), updated,
            )

    # Quick post-run health snapshot.
    async with AsyncSessionLocal() as db:
        total_chunks = (await db.execute(select(func.count(DocumentChunk.id)))).scalar() or 0
        null_chunks = (
            await db.execute(
                select(func.count(DocumentChunk.id)).where(DocumentChunk.embedding.is_(None))
            )
        ).scalar() or 0

    logger.info(
        "Done. processed=%d updated=%d skipped=%d failed=%d "
        "[db now: total_chunks=%d, null_embeddings=%d]",
        total, updated, skipped, failed, total_chunks, null_chunks,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
