"""add_debate_follow_ups_and_round_cycles

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-06 00:00:00.000000

Adds:
  - rounds.cycle_number (Integer, default 1) — groups rounds into debate cycles.
  - Extends round_type enum with 3 new values for follow-up cycles:
      followup_response, followup_critique, updated_synthesis
  - debate_follow_ups table — one row per user follow-up question.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_ROUND_TYPES = ("followup_response", "followup_critique", "updated_synthesis")


def upgrade() -> None:
    # 1. Extend round_type enum with the new follow-up values (Postgres-only API)
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in _NEW_ROUND_TYPES:
            op.execute(f"ALTER TYPE round_type ADD VALUE IF NOT EXISTS '{value}'")
    # On SQLite (test/dev) the Enum is just a check-constraint string; nothing to do.

    # 2. Add cycle_number column to rounds (default 1 for existing rows)
    op.add_column(
        "rounds",
        sa.Column(
            "cycle_number",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )

    # 3. Create debate_follow_ups table
    op.create_table(
        "debate_follow_ups",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "chat_session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "chat_turn_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("chat_turns.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("cycle_number", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("debate_follow_ups")
    op.drop_column("rounds", "cycle_number")
    # Postgres has no clean "DROP VALUE" — leave the enum extension in place.
