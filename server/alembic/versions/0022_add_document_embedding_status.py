"""add_document_embedding_status

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-10 00:00:00.000000

Add an ``embedding_status`` column to documents so the embedding lifecycle is
tracked independently of the document ``status``. This is the schema half of
the RAG upload refactor: a document becomes ``ready`` the moment its chunks are
stored, while ``embedding_status`` (pending|ready|failed|disabled) records
whether semantic vectors were produced. A failed/disabled embedding provider no
longer leaves documents stuck in ``processing``.

Stored as a short VARCHAR (not a PostgreSQL enum) on purpose — adding values to
a PG enum requires ALTER TYPE which is fragile under asyncpg's prepared-statement
cache. A plain string keeps the column trivially evolvable.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0022"
down_revision: Union[str, Sequence[str], None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    row = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :t AND column_name = :c"
    ), {"t": table, "c": column}).fetchone()
    return row is not None


def upgrade() -> None:
    if not _column_exists("documents", "embedding_status"):
        op.add_column(
            "documents",
            sa.Column(
                "embedding_status",
                sa.String(length=16),
                nullable=False,
                server_default="pending",
            ),
        )
        # Backfill: any document already ``ready`` with chunks predates this
        # column. Mark them ``ready`` so the UI/retrieval treat them as having
        # usable embeddings (they were embedded under the old pipeline).
        op.execute(
            "UPDATE documents SET embedding_status = 'ready' WHERE status = 'ready'"
        )


def downgrade() -> None:
    if _column_exists("documents", "embedding_status"):
        op.drop_column("documents", "embedding_status")
