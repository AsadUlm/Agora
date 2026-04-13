import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class SenderType(str, enum.Enum):
    user = "user"
    agent = "agent"
    judge = "judge"
    system = "system"


class MessageType(str, enum.Enum):
    user_input = "user_input"
    agent_response = "agent_response"
    critique = "critique"
    final_summary = "final_summary"
    system_notice = "system_notice"


class MessageVisibility(str, enum.Enum):
    visible = "visible"
    internal = "internal"


class Message(Base):
    """Stores all textual content. Single source of truth."""
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_turn_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_turns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("rounds.id", ondelete="CASCADE"), nullable=True, index=True
    )
    chat_agent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_agents.id", ondelete="CASCADE"), nullable=True
    )
    
    sender_type: Mapped[SenderType] = mapped_column(
        SQLEnum(SenderType, name="sender_type"), nullable=False
    )
    message_type: Mapped[MessageType] = mapped_column(
        SQLEnum(MessageType, name="message_type"), nullable=False
    )
    visibility: Mapped[MessageVisibility] = mapped_column(
        SQLEnum(MessageVisibility, name="message_visibility"), nullable=False, default=MessageVisibility.visible
    )
    
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    chat_session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")
    chat_turn: Mapped["ChatTurn"] = relationship("ChatTurn", back_populates="messages")
    round: Mapped["Round"] = relationship("Round", back_populates="messages")
    chat_agent: Mapped["ChatAgent"] = relationship("ChatAgent", back_populates="messages")
