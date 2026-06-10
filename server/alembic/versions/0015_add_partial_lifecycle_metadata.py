"""add partial lifecycle metadata

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-09 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE chat_turn_status ADD VALUE IF NOT EXISTS 'partially_completed'")
        op.execute("ALTER TYPE round_status ADD VALUE IF NOT EXISTS 'partially_completed'")

    op.add_column(
        "chat_turns",
        sa.Column("synthesis_status", sa.String(length=16), server_default="pending", nullable=False),
    )
    op.add_column(
        "chat_turns",
        sa.Column("request_id", sa.String(length=64), server_default=sa.text("gen_random_uuid()::text") if bind.dialect.name == "postgresql" else "legacy", nullable=False),
    )
    op.add_column("chat_turns", sa.Column("error_metadata", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_turns", "error_metadata")
    op.drop_column("chat_turns", "request_id")
    op.drop_column("chat_turns", "synthesis_status")
