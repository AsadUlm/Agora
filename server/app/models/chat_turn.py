import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, Integer, String, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ChatTurnStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    partially_completed = "partially_completed"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ChatTurn(Base):
    """One user question + full execution cycle."""
    __tablename__ = "chat_turns"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ChatTurnStatus] = mapped_column(
        SQLEnum(ChatTurnStatus, name="chat_turn_status"), nullable=False, default=ChatTurnStatus.queued
    )
    current_round_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Step-by-step support: "auto" runs the whole turn through; "manual"
    # gates each agent on the StepController and waits for /next-step.
    execution_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="auto", server_default="auto"
    )
    synthesis_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    request_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=lambda: str(uuid.uuid4())
    )
    error_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response_language_code: Mapped[str] = mapped_column(String(16), nullable=False, default="en", server_default="en")
    response_language_name: Mapped[str] = mapped_column(String(64), nullable=False, default="English", server_default="English")
    response_language_source: Mapped[str] = mapped_column(String(24), nullable=False, default="fallback", server_default="fallback")
    response_language_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.6, server_default="0.6")
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
    chat_session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="chat_turns")
    rounds: Mapped[list["Round"]] = relationship("Round", back_populates="chat_turn", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="chat_turn", cascade="all, delete-orphan")
    llm_calls: Mapped[list["LLMCall"]] = relationship("LLMCall", back_populates="chat_turn", cascade="all, delete-orphan")
