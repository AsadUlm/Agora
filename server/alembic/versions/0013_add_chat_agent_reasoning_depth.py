"""add_chat_agent_reasoning_depth

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-18 00:00:00.000000

Adds ``chat_agents.reasoning_depth`` so the per-agent reasoning depth
(shallow / normal / deep) selected in the UI is persisted alongside
``reasoning_style`` and survives the debate background-task reload.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_agents",
        sa.Column(
            "reasoning_depth",
            sa.String(length=40),
            nullable=True,
            server_default="normal",
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_agents", "reasoning_depth")
