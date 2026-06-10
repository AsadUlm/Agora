"""add_followup_traceable_rounds

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-09 18:00:00.000000

Adds three new round_type enum values to support the 5-stage traceable debate pipeline in follow-up cycles:
  - followup_cross_critique
  - followup_response_to_critique
  - followup_revised_position
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0017"
down_revision: Union[str, Sequence[str], None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_ROUND_TYPES = ("followup_cross_critique", "followup_response_to_critique", "followup_revised_position")


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
