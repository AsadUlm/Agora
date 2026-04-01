"""add_auth_fields_and_user_settings

Revision ID: a1b2c3d4e5f6
Revises: 404b0643b23f
Create Date: 2026-04-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "404b0643b23f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Add new columns to users table ────────────────────────────────
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("auth_provider", sa.String(length=50), nullable=True))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=True))

    # Backfill existing rows with defaults
    op.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
    op.execute("UPDATE users SET auth_provider = 'email' WHERE auth_provider IS NULL")
    op.execute("UPDATE users SET is_active = TRUE WHERE is_active IS NULL")

    # Now set NOT NULL constraints
    op.alter_column("users", "password_hash", nullable=False)
    op.alter_column("users", "auth_provider", nullable=False)
    op.alter_column("users", "is_active", nullable=False)

    # ── Create user_settings table ────────────────────────────────────
    op.create_table(
        "user_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("theme", sa.String(length=50), nullable=False, server_default="system"),
        sa.Column("language", sa.String(length=10), nullable=False, server_default="en"),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_settings")

    op.drop_column("users", "is_active")
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "display_name")
    op.drop_column("users", "password_hash")
