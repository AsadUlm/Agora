"""change_embedding_dim_to_768

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-20 00:00:00.000000

Changes document_chunks.embedding from Vector(1536) to Vector(768)
to match the Gemini text-embedding-004 output dimension.

Also drops and recreates the HNSW index with the new dimension.

Environment-safe: local PostgreSQL installations that do not have the
pgvector extension skip the vector column / HNSW-index operations so that
the migration still completes cleanly.  Cloud SQL (which has pgvector
enabled) receives the full upgrade.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _try_enable_pgvector() -> bool:
    """Attempt to CREATE EXTENSION vector using a SAVEPOINT so that the
    surrounding transaction stays valid even when the extension is not
    installed on the server.  Returns True when pgvector is available."""
    conn = op.get_bind()
    conn.execute(sa.text("SAVEPOINT _pgv"))
    try:
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(sa.text("RELEASE SAVEPOINT _pgv"))
        return True
    except Exception:
        conn.execute(sa.text("ROLLBACK TO SAVEPOINT _pgv"))
        return False


def upgrade() -> None:
    vector_ok = _try_enable_pgvector()

    # Drop the old HNSW index unconditionally (safe without pgvector).
    op.execute(sa.text("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw"))

    # Dimension change invalidates all stored embeddings — truncate first.
    op.execute(sa.text("TRUNCATE TABLE document_chunks"))

    # Remove the old embedding column (works for both `vector` and `json` types).
    op.execute(sa.text("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding"))

    if vector_ok:
        op.execute(sa.text("ALTER TABLE document_chunks ADD COLUMN embedding vector(768)"))
        op.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw"
            " ON document_chunks"
            " USING hnsw (embedding vector_cosine_ops)"
            " WITH (m = 16, ef_construction = 64)"
        ))


def downgrade() -> None:
    vector_ok = _try_enable_pgvector()

    op.execute(sa.text("DROP INDEX IF EXISTS ix_document_chunks_embedding_hnsw"))
    op.execute(sa.text("TRUNCATE TABLE document_chunks"))
    op.execute(sa.text("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding"))

    if vector_ok:
        op.execute(sa.text("ALTER TABLE document_chunks ADD COLUMN embedding vector(1536)"))
        op.execute(sa.text(
            "CREATE INDEX IF NOT EXISTS ix_document_chunks_embedding_hnsw"
            " ON document_chunks"
            " USING hnsw (embedding vector_cosine_ops)"
            " WITH (m = 16, ef_construction = 64)"
        ))
