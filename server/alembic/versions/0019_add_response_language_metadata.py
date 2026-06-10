"""add_response_language_metadata

Revision ID: 0019
Revises: 0018
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, Sequence[str], None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_language_columns(table: str) -> None:
    op.add_column(table, sa.Column("response_language_code", sa.String(length=16), nullable=False, server_default="en"))
    op.add_column(table, sa.Column("response_language_name", sa.String(length=64), nullable=False, server_default="English"))
    op.add_column(table, sa.Column("response_language_source", sa.String(length=24), nullable=False, server_default="fallback"))
    op.add_column(table, sa.Column("response_language_confidence", sa.Float(), nullable=False, server_default="0.6"))


def upgrade() -> None:
    _add_language_columns("chat_turns")
    _add_language_columns("debate_follow_ups")


def downgrade() -> None:
    for table in ("debate_follow_ups", "chat_turns"):
        op.drop_column(table, "response_language_confidence")
        op.drop_column(table, "response_language_source")
        op.drop_column(table, "response_language_name")
        op.drop_column(table, "response_language_code")
