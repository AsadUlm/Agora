"""DebateFollowUp — user-asked follow-up question that opens a new debate cycle."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, Text, Uuid, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DebateFollowUp(Base):
    """A follow-up question the user asks after the initial 3-round debate.

    Each follow-up opens a new "cycle" (cycle_number ≥ 2) of three rounds
    (followup_response → followup_critique → updated_synthesis) attached to the
    same ChatTurn so the debate memory is preserved.
    """

    __tablename__ = "debate_follow_ups"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chat_turn_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chat_turns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    cycle_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Compact memory snapshot generated after this cycle's updated synthesis.
    # Used as compressed input for subsequent cycles instead of the full history.
    cycle_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    chat_session = relationship("ChatSession", overlaps="follow_ups")
    chat_turn = relationship("ChatTurn")
