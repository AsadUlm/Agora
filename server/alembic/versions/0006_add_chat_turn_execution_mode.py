"""add_chat_turn_execution_mode

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-29 00:00:00.000000

Adds:
  - chat_turns.execution_mode (str, "auto"/"manual", default "auto")
    Drives the StepController gate for step-by-step debate execution.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_turns",
        sa.Column(
            "execution_mode",
            sa.String(16),
            nullable=False,
            server_default="auto",
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_turns", "execution_mode")
