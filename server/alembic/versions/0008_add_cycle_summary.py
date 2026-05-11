"""add_cycle_summary_to_debate_follow_ups

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-06 12:00:00.000000

Adds:
  - debate_follow_ups.cycle_summary (Text, nullable) — compact memory snapshot
    generated after the cycle's updated synthesis, used as compressed input
    for subsequent follow-up cycles instead of the full message history.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "debate_follow_ups",
        sa.Column("cycle_summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("debate_follow_ups", "cycle_summary")
