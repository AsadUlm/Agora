"""add_queued_to_round_status

round_status enum in the DB is missing the 'queued' value.
The initial schema migration originally created round_status with:
  queued, started, completed, failed
Migration 0002 renamed 'started' → 'running'.

However, databases created from an older version of 0001 (before 'queued' was
added) have round_status = {started/running, completed, failed} with no 'queued'.

This migration adds 'queued' before 'running' to match the Python enum in
app/models/round.py:
  RoundStatus.queued   = "queued"
  RoundStatus.running  = "running"
  RoundStatus.completed = "completed"
  RoundStatus.failed   = "failed"

ALTER TYPE ... ADD VALUE is idempotent-friendly (IF NOT EXISTS, PostgreSQL 9.6+).

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-10
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ADD VALUE IF NOT EXISTS — safe to run even if 'queued' already exists
    # (databases created from the correct 0001 already have it).
    op.execute("ALTER TYPE round_status ADD VALUE IF NOT EXISTS 'queued' BEFORE 'running'")


def downgrade() -> None:
    # PostgreSQL has no DROP VALUE for enums.
    # Downgrade is a no-op — the value stays but becomes unused.
    pass
