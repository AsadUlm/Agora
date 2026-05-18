"""placeholder migration (no-op)

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-11 00:00:00.000000
"""

from typing import Sequence, Union

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
