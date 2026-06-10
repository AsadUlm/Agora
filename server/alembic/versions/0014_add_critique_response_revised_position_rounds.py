"""add_critique_response_revised_position_rounds

Revision ID: 0014
Revises: 8b6f2e13a01f
Create Date: 2026-06-08 00:00:00.000000

Adds two new round_type enum values to support the 5-stage traceable debate pipeline:
  - critique_response: agents respond to critiques they received
  - revised_position: agents produce updated positions after critique exchange
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "8b6f2e13a01f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_ROUND_TYPES = ("critique_response", "revised_position")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in _NEW_ROUND_TYPES:
            op.execute(f"ALTER TYPE round_type ADD VALUE IF NOT EXISTS '{value}'")
    # SQLite: enum is stored as string; no DDL change needed.


def downgrade() -> None:
    # PostgreSQL does not support removing enum values natively.
    # A full recreate would be needed; skip for safety.
    pass
