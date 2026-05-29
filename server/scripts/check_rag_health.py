"""
Check the health of the RAG pipeline end-to-end.

What it verifies:
  1. EmbeddingService is correctly configured (provider, model, dim).
  2. The provider is NOT Mock (or warns if it is).
  3. There are document chunks with non-zero embeddings in the DB.
  4. (If --session-id given) RetrievalService returns at least one chunk
     for the supplied query.

Examples (run from the ``server/`` directory):

    python -m scripts.check_rag_health
    python -m scripts.check_rag_health --session-id 8e3c... --query "What does the contract say about termination?"

The script prints PASS / WARN / FAIL for each check and exits with code 0
when no FAIL was reported.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import uuid
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SERVER_ROOT = _HERE.parent
if str(_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVER_ROOT))

from sqlalchemy import func, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.document import Document, DocumentStatus  # noqa: E402
from app.models.document_chunk import DocumentChunk  # noqa: E402
from app.services.embeddings.embedding_service import (  # noqa: E402
    EMBEDDING_DIM,
    EmbeddingProviderError,
    MockEmbeddingService,
    get_embedding_service,
)
from app.services.retrieval.retrieval_service import RetrievalService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)-5s %(message)s")
logger = logging.getLogger("rag-health")


_ZERO_EPS = 1e-9


def _print(status: str, msg: str) -> None:
    print(f"[{status:<4}] {msg}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-id", type=str, help="Run a live retrieval test for this session.")
    parser.add_argument("--query", type=str, default="What is this document about?", help="Query for the retrieval test.")
    args = parser.parse_args()

    fails = 0
    warns = 0

    # ── 1. Provider config ────────────────────────────────────────────────
    _print("INFO", f"EMBEDDING_PROVIDER = {settings.EMBEDDING_PROVIDER!r}")
    _print("INFO", f"EMBEDDING_MODEL    = {settings.EMBEDDING_MODEL!r}")
    _print("INFO", f"EMBEDDING_DIM      = {settings.EMBEDDING_DIM}")

    try:
        svc = get_embedding_service()
    except EmbeddingProviderError as exc:
        _print("FAIL", f"EmbeddingService failed to initialise: {exc}")
        return 1

    if isinstance(svc, MockEmbeddingService):
        _print("WARN", "EmbeddingService is MockEmbeddingService — RAG will be non-semantic.")
        warns += 1
    else:
        _print("PASS", f"EmbeddingService is {type(svc).__name__}.")

    if settings.EMBEDDING_DIM != EMBEDDING_DIM:
        _print(
            "FAIL",
            f"Configured EMBEDDING_DIM={settings.EMBEDDING_DIM} differs from "
            f"module-level EMBEDDING_DIM={EMBEDDING_DIM}. DB column is Vector(768).",
        )
        fails += 1
    else:
        _print("PASS", f"Dimension matches DB column ({EMBEDDING_DIM}).")

    # ── 2. Live embed test ───────────────────────────────────────────────
    try:
        vec = await svc.embed("Health check probe.")
    except Exception as exc:
        _print("FAIL", f"Embedding call raised: {exc}")
        return 1

    if len(vec) != EMBEDDING_DIM:
        _print("FAIL", f"Embed returned dim={len(vec)}, expected {EMBEDDING_DIM}.")
        fails += 1
    elif all(abs(v) < _ZERO_EPS for v in vec):
        _print("WARN", "Embed returned an all-zero vector (Mock provider?).")
        warns += 1
    else:
        nonzero = sum(1 for v in vec if abs(v) > _ZERO_EPS)
        _print("PASS", f"Embed returned dim={len(vec)}, nonzero={nonzero}.")

    # ── 3. DB-side embedding sanity ──────────────────────────────────────
    async with AsyncSessionLocal() as db:
        total_chunks = (await db.execute(select(func.count(DocumentChunk.id)))).scalar() or 0
        null_chunks = (
            await db.execute(
                select(func.count(DocumentChunk.id)).where(DocumentChunk.embedding.is_(None))
            )
        ).scalar() or 0
        ready_docs = (
            await db.execute(
                select(func.count(Document.id)).where(Document.status == DocumentStatus.ready)
            )
        ).scalar() or 0
        _print(
            "INFO",
            f"DB chunks: total={total_chunks}, null_embedding={null_chunks}, ready_documents={ready_docs}",
        )

        if total_chunks == 0:
            _print("WARN", "No document chunks in DB — upload a document first.")
            warns += 1
        elif null_chunks == total_chunks:
            _print("FAIL", "Every chunk has a NULL embedding.")
            fails += 1
        elif null_chunks > 0:
            _print("WARN", f"{null_chunks} chunk(s) have NULL embeddings — run scripts/reembed_documents.py.")
            warns += 1

        # Sample a few chunks and check whether their stored vector is all-zero.
        sample_stmt = (
            select(DocumentChunk.embedding)
            .where(DocumentChunk.embedding.is_not(None))
            .limit(5)
        )
        try:
            sample = (await db.execute(sample_stmt)).scalars().all()
            zero_in_sample = sum(
                1 for v in sample if v is not None and all(abs(float(x)) < _ZERO_EPS for x in v)
            )
            if sample and zero_in_sample == len(sample):
                _print(
                    "FAIL",
                    f"All {len(sample)} sampled embeddings are zero — run scripts/reembed_documents.py "
                    "after switching to a real EMBEDDING_PROVIDER.",
                )
                fails += 1
            elif zero_in_sample > 0:
                _print("WARN", f"{zero_in_sample}/{len(sample)} sampled embeddings are zero.")
                warns += 1
            elif sample:
                _print("PASS", f"{len(sample)} sampled embeddings are non-zero.")
        except Exception as exc:
            _print("WARN", f"Could not sample chunk embeddings: {exc}")
            warns += 1

        # ── 4. End-to-end retrieval test ─────────────────────────────────
        if args.session_id:
            try:
                session_uuid = uuid.UUID(args.session_id)
            except ValueError:
                _print("FAIL", f"--session-id is not a valid UUID: {args.session_id!r}")
                return 1
            retr = RetrievalService()
            try:
                chunks = await retr.retrieve(args.query, session_uuid, db=db, top_k=3)
            except Exception as exc:
                _print("FAIL", f"RetrievalService.retrieve raised: {exc}")
                return 1
            if not chunks:
                _print("FAIL", "Retrieval returned 0 chunks for the test query.")
                fails += 1
            else:
                top = ", ".join(f"{c.similarity_score:.3f}" for c in chunks[:3])
                _print("PASS", f"Retrieval returned {len(chunks)} chunk(s); top sims=[{top}]")

    _print("INFO", f"Summary: {fails} fail / {warns} warn")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
