import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ChatSessionStatus(str, enum.Enum):
    active = "active"
    archived = "archived"
    deleted = "deleted"


class ChatSession(Base):
    """Top-level conversation session."""
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ChatSessionStatus] = mapped_column(
        SQLEnum(ChatSessionStatus, name="chat_session_status"), nullable=False, default=ChatSessionStatus.active
    )
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
    user: Mapped["User"] = relationship("User", back_populates="chat_sessions")
    chat_agents: Mapped[list["ChatAgent"]] = relationship("ChatAgent", back_populates="chat_session", cascade="all, delete-orphan")
    chat_turns: Mapped[list["ChatTurn"]] = relationship("ChatTurn", back_populates="chat_session", cascade="all, delete-orphan")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="chat_session", cascade="all, delete-orphan")
