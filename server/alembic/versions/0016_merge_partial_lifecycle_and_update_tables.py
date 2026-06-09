"""merge partial lifecycle and update_tables heads

Revision ID: 0016
Revises: 0015, 2106cbaf8a6e
Create Date: 2026-06-09 16:00:00.000000
"""

from typing import Sequence, Union


revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = ("0015", "2106cbaf8a6e")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
