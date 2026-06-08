"""add_document_storage_columns

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-12 00:00:00.000000

Step 30 — Cloudinary document storage:
  - Add storage_provider / storage_public_id / storage_url / storage_secure_url
    / storage_resource_type / storage_format / storage_bytes columns to
    documents.
  - Add original_filename / content_type columns to documents.
  - Ensure documents.file_path exists and is nullable so cloud-only rows
    have NULL there.  The column is idempotently created when it was
    skipped by a stamp-based setup (0004 not actually executed).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
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
    # Ensure file_path exists (may have been skipped when the DB was set up
    # via create_all / alembic stamp without running migration 0004).
    if not _column_exists("documents", "file_path"):
        op.add_column(
            "documents",
            sa.Column("file_path", sa.String(length=1024), nullable=True),
        )
    else:
        # Loosen file_path so cloud-only rows can omit it.
        op.alter_column(
            "documents",
            "file_path",
            existing_type=sa.String(length=1024),
            nullable=True,
        )

    # Add storage columns (idempotent via IF NOT EXISTS check).
    if not _column_exists("documents", "storage_provider"):
        op.add_column(
            "documents",
            sa.Column(
                "storage_provider",
                sa.String(length=32),
                nullable=False,
                server_default="local",
            ),
        )
    if not _column_exists("documents", "storage_public_id"):
        op.add_column("documents", sa.Column("storage_public_id", sa.String(length=512), nullable=True))
    if not _column_exists("documents", "storage_url"):
        op.add_column("documents", sa.Column("storage_url", sa.String(length=1024), nullable=True))
    if not _column_exists("documents", "storage_secure_url"):
        op.add_column("documents", sa.Column("storage_secure_url", sa.String(length=1024), nullable=True))
    if not _column_exists("documents", "storage_resource_type"):
        op.add_column("documents", sa.Column("storage_resource_type", sa.String(length=32), nullable=True))
    if not _column_exists("documents", "storage_format"):
        op.add_column("documents", sa.Column("storage_format", sa.String(length=32), nullable=True))
    if not _column_exists("documents", "storage_bytes"):
        op.add_column("documents", sa.Column("storage_bytes", sa.BigInteger(), nullable=True))
    if not _column_exists("documents", "original_filename"):
        op.add_column("documents", sa.Column("original_filename", sa.String(length=255), nullable=True))
    if not _column_exists("documents", "content_type"):
        op.add_column("documents", sa.Column("content_type", sa.String(length=128), nullable=True))


def downgrade() -> None:
    for col in (
        "content_type",
        "original_filename",
        "storage_bytes",
        "storage_format",
        "storage_resource_type",
        "storage_secure_url",
        "storage_url",
        "storage_public_id",
        "storage_provider",
    ):
        if _column_exists("documents", col):
            op.drop_column("documents", col)
    # Only revert nullability if the column already existed before this migration.
    if _column_exists("documents", "file_path"):
        op.alter_column(
            "documents",
            "file_path",
            existing_type=sa.String(length=1024),
            nullable=False,
        )
