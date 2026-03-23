"""initial_schema

Revision ID: 404b0643b23f
Revises:
Create Date: 2025-01-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "404b0643b23f"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ─────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # ── debates ───────────────────────────────────────────────────────
    op.create_table(
        "debates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_debates_user_id"), "debates", ["user_id"])

    # ── agents ────────────────────────────────────────────────────────
    op.create_table(
        "agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("debate_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=100), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["debate_id"], ["debates.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agents_debate_id"), "agents", ["debate_id"])

    # ── rounds ────────────────────────────────────────────────────────
    op.create_table(
        "rounds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("debate_id", sa.Uuid(), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(["debate_id"], ["debates.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rounds_debate_id"), "rounds", ["debate_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_rounds_debate_id"), table_name="rounds")
    op.drop_table("rounds")

    op.drop_index(op.f("ix_agents_debate_id"), table_name="agents")
    op.drop_table("agents")

    op.drop_index(op.f("ix_debates_user_id"), table_name="debates")
    op.drop_table("debates")

    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
