"""add_document_storage_columns

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-12 00:00:00.000000

Step 30 — Cloudinary document storage:
  - Add storage_provider / storage_public_id / storage_url / storage_secure_url
    / storage_resource_type / storage_format / storage_bytes columns to
    documents.
  - Add original_filename / content_type columns to documents.
  - Make documents.file_path nullable so cloud-only rows have NULL there.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column(
            "storage_provider",
            sa.String(length=32),
            nullable=False,
            server_default="local",
        ),
    )
    op.add_column("documents", sa.Column("storage_public_id", sa.String(length=512), nullable=True))
    op.add_column("documents", sa.Column("storage_url", sa.String(length=1024), nullable=True))
    op.add_column("documents", sa.Column("storage_secure_url", sa.String(length=1024), nullable=True))
    op.add_column("documents", sa.Column("storage_resource_type", sa.String(length=32), nullable=True))
    op.add_column("documents", sa.Column("storage_format", sa.String(length=32), nullable=True))
    op.add_column("documents", sa.Column("storage_bytes", sa.BigInteger(), nullable=True))
    op.add_column("documents", sa.Column("original_filename", sa.String(length=255), nullable=True))
    op.add_column("documents", sa.Column("content_type", sa.String(length=128), nullable=True))

    # Loosen file_path so cloud-only rows can omit it.
    op.alter_column(
        "documents",
        "file_path",
        existing_type=sa.String(length=1024),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "documents",
        "file_path",
        existing_type=sa.String(length=1024),
        nullable=False,
    )
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
        op.drop_column("documents", col)
