"""add_document_processing_timestamps

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-10 00:00:00.000000

Add processing_started_at / processed_at columns to documents so the
ingestion pipeline can record lifecycle timing and the status endpoint can
detect (and recover) documents that are stuck in ``processing`` after a
server restart or a killed background task.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0021"
down_revision: Union[str, Sequence[str], None] = "0020"
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
    if not _column_exists("documents", "processing_started_at"):
        op.add_column(
            "documents",
            sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _column_exists("documents", "processed_at"):
        op.add_column(
            "documents",
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("documents", "processed_at"):
        op.drop_column("documents", "processed_at")
    if _column_exists("documents", "processing_started_at"):
        op.drop_column("documents", "processing_started_at")
