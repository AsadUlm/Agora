"""add_system_prompt_to_chat_agents

Adds an optional system_prompt column to chat_agents so per-agent custom
instructions from the frontend can be persisted and used in LLM prompts.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: str = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_agents",
        sa.Column("system_prompt", sa.String(4000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_agents", "system_prompt")
