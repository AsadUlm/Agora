"""status_enum_cleanup

Rename inconsistent status enum values to match the unified async-ready lifecycle model:

  round_status:    "started"  → "running"
  llm_call_status: "started"  → "running"
  llm_call_status: "success"  → "completed"

Rationale:
  - ChatTurnStatus already uses "running" (correct).
  - Using "started" in RoundStatus and LLMCallStatus was inconsistent.
  - "success" vs "completed" was inconsistent across the status model.
  - The unified model is: queued → running → completed | failed | cancelled

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── round_status: started → running ──────────────────────────────────────
    # ALTER TYPE ... RENAME VALUE is available since PostgreSQL 10.
    # Existing rows that stored "started" automatically reflect "running" after
    # this statement — no UPDATE needed (PostgreSQL stores enum values by label).
    op.execute("ALTER TYPE round_status RENAME VALUE 'started' TO 'running'")

    # ── llm_call_status: started → running ───────────────────────────────────
    op.execute("ALTER TYPE llm_call_status RENAME VALUE 'started' TO 'running'")

    # ── llm_call_status: success → completed ─────────────────────────────────
    op.execute("ALTER TYPE llm_call_status RENAME VALUE 'success' TO 'completed'")


def downgrade() -> None:
    op.execute("ALTER TYPE llm_call_status RENAME VALUE 'completed' TO 'success'")
    op.execute("ALTER TYPE llm_call_status RENAME VALUE 'running' TO 'started'")
    op.execute("ALTER TYPE round_status RENAME VALUE 'running' TO 'started'")
