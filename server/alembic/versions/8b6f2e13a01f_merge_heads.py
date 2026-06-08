"""merge_heads

Revision ID: 8b6f2e13a01f
Revises: 0011, 0013
Create Date: 2026-05-18 17:16:27.921759

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b6f2e13a01f'
down_revision: Union[str, None] = ('0011', '0013')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
