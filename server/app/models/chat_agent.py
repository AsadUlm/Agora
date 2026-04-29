import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Uuid, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ChatAgent(Base):
    """Agents configured per session."""
    __tablename__ = "chat_agents"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    reasoning_style: Mapped[str | None] = mapped_column(String(100), nullable=True)
    position_order: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    knowledge_mode: Mapped[str | None] = mapped_column(String(50), nullable=True, default="shared_session_docs")
    knowledge_strict: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
    chat_session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="chat_agents")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="chat_agent", cascade="all, delete-orphan")
    llm_calls: Mapped[list["LLMCall"]] = relationship("LLMCall", back_populates="chat_agent", cascade="all, delete-orphan")
    document_bindings: Mapped[list["AgentDocumentBinding"]] = relationship("AgentDocumentBinding", back_populates="chat_agent", cascade="all, delete-orphan")
