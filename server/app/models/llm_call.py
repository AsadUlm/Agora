import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class LLMCallStatus(str, enum.Enum):
    started = "started"
    success = "success"
    failed = "failed"


class LLMCall(Base):
    """Logs of model execution."""
    __tablename__ = "llm_calls"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_turn_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_turns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_agent_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_agents.id", ondelete="CASCADE"), nullable=False
    )
    
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    status: Mapped[LLMCallStatus] = mapped_column(
        SQLEnum(LLMCallStatus, name="llm_call_status"), nullable=False, default=LLMCallStatus.started
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    chat_turn: Mapped["ChatTurn"] = relationship("ChatTurn", back_populates="llm_calls")
    round: Mapped["Round"] = relationship("Round", back_populates="llm_calls")
    chat_agent: Mapped["ChatAgent"] = relationship("ChatAgent", back_populates="llm_calls")
