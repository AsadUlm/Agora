"""ensure_chat_turn_execution_mode

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-04 00:00:00.000000

Some local databases were stamped past 0006 during branch conflict cleanup
without actually receiving chat_turns.execution_mode. Keep this migration
idempotent so it repairs those databases and is harmless on healthy ones.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE chat_turns
        ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(16) NOT NULL DEFAULT 'auto'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE chat_turns DROP COLUMN IF EXISTS execution_mode")
