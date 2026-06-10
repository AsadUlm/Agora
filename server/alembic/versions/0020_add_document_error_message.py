"""add_document_error_message

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-10 00:00:00.000000

Add error_message column to documents table so failed-processing documents
expose the failure reason via the API.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0020"
down_revision: Union[str, Sequence[str], None] = "0019"
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
    if not _column_exists("documents", "error_message"):
        op.add_column(
            "documents",
            sa.Column("error_message", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("documents", "error_message"):
        op.drop_column("documents", "error_message")
