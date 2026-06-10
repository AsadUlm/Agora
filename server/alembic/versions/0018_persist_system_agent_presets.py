"""persist_system_agent_presets

Revision ID: 0018
Revises: 0017
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, Sequence[str], None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("agent_presets", "user_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column(
        "agent_presets",
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("agent_presets", sa.Column("system_key", sa.String(length=80), nullable=True))
    op.create_index("ix_agent_presets_system_key", "agent_presets", ["system_key"], unique=True)


def downgrade() -> None:
    op.execute("DELETE FROM agent_presets WHERE is_system = true")
    op.drop_index("ix_agent_presets_system_key", table_name="agent_presets")
    op.drop_column("agent_presets", "system_key")
    op.drop_column("agent_presets", "is_system")
    op.alter_column("agent_presets", "user_id", existing_type=sa.Uuid(), nullable=False)
