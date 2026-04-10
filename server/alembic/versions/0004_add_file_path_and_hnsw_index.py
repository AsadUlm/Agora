"""add_file_path_and_hnsw_index

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-11 00:00:00.000000

Adds:
  - documents.file_path  VARCHAR(1024)  (local path where uploaded file is stored)
  - HNSW index on document_chunks.embedding for fast approximate-NN retrieval
    (pgvector >= 0.5 required; existing cosine-distance queries use this automatically)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add file_path column to documents
    op.add_column(
        "documents",
        sa.Column("file_path", sa.String(length=1024), nullable=False, server_default=""),
    )
    # Remove server_default after adding so new rows rely on application code
    op.alter_column("documents", "file_path", server_default=None)

    # 2. HNSW index on document_chunks.embedding for cosine similarity
    #    Using m=16, ef_construction=64 — good default for up to ~1M vectors.
    #    The operator class `vector_cosine_ops` matches the <=> operator used
    #    in the retrieval query.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw
        ON document_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw")
    op.drop_column("documents", "file_path")
