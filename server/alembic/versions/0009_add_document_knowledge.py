"""add_document_knowledge_metadata

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-12 00:00:00.000000

Step 31 — Knowledge Intelligence Layer.

Adds three optional columns to ``documents``:
  - document_type      VARCHAR(64)  — coarse classification used for retrieval routing
  - document_summary   TEXT         — 2–4 sentence compressed digest
  - knowledge_metadata JSON         — structured payload: topics / claims / entities / risk_domains

All columns are nullable and additive. Existing documents stay valid; the
knowledge extractor backfills these fields on subsequent ingestion. No data
loss is possible.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("document_type", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("document_summary", sa.Text(), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("knowledge_metadata", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "knowledge_metadata")
    op.drop_column("documents", "document_summary")
    op.drop_column("documents", "document_type")
