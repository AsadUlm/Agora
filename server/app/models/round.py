import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RoundType(str, enum.Enum):
    initial = "initial"
    critique = "critique"
    final = "final"


class RoundStatus(str, enum.Enum):
    queued = "queued"
    started = "started"
    completed = "completed"
    failed = "failed"


class Round(Base):
    """Stages of debate (1, 2, 3) within a Turn."""
    __tablename__ = "rounds"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_turn_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_turns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    round_type: Mapped[RoundType] = mapped_column(
        SQLEnum(RoundType, name="round_type"), nullable=False
    )
    status: Mapped[RoundStatus] = mapped_column(
        SQLEnum(RoundStatus, name="round_status"), nullable=False, default=RoundStatus.started
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    chat_turn: Mapped["ChatTurn"] = relationship("ChatTurn", back_populates="rounds")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="round", cascade="all, delete-orphan")
    llm_calls: Mapped[list["LLMCall"]] = relationship("LLMCall", back_populates="round", cascade="all, delete-orphan")
