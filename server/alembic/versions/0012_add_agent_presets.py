"""add_agent_presets

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-18 00:00:00.000000

Adds the ``agent_presets`` table backing the new Agent Presets
management feature. System presets remain code-defined constants and are
not stored here — only user-created presets persist.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_presets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="private",
        ),
        sa.Column(
            "role_description",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
        sa.Column("reasoning_style", sa.String(length=80), nullable=False),
        sa.Column("reasoning_depth", sa.String(length=40), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("model_preset", sa.String(length=40), nullable=True),
        sa.Column(
            "temperature",
            sa.Float(),
            nullable=False,
            server_default=sa.text("0.7"),
        ),
        sa.Column(
            "rag_mode",
            sa.String(length=40),
            nullable=False,
            server_default="shared_session_docs",
        ),
        sa.Column(
            "document_ids",
            sa.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "strict_grounding",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_agent_presets_user_id"),
        "agent_presets",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_presets_user_id"), table_name="agent_presets")
    op.drop_table("agent_presets")
