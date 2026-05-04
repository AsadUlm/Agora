"""restore_queued_round_status

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-29 00:00:00.000000

Add the ``queued`` enum label expected by RoundManager. Debate execution
creates a round as queued before immediately transitioning it to running.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE round_status ADD VALUE IF NOT EXISTS 'queued' BEFORE 'running'")


def downgrade() -> None:
    # PostgreSQL cannot drop a single enum label without rebuilding the type.
    # Keeping it is safe because the application schema expects it.
    pass
