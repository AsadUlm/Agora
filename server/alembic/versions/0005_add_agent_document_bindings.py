"""add_agent_document_bindings

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-16 00:00:00.000000

Adds:
  - agent_document_bindings table: links specific documents to individual agents
    for agent-scoped knowledge / RAG retrieval.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add knowledge columns to chat_agents
    op.add_column(
        "chat_agents",
        sa.Column("knowledge_mode", sa.String(50), nullable=True, server_default="shared_session_docs"),
    )
    op.add_column(
        "chat_agents",
        sa.Column("knowledge_strict", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # 2. Create agent_document_bindings table
    op.create_table(
        "agent_document_bindings",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("chat_agent_id", sa.Uuid(as_uuid=True), sa.ForeignKey("chat_agents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_id", sa.Uuid(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("chat_agent_id", "document_id", name="uq_agent_document"),
    )


def downgrade() -> None:
    op.drop_table("agent_document_bindings")
    op.drop_column("chat_agents", "knowledge_strict")
    op.drop_column("chat_agents", "knowledge_mode")
