"""Agent ↔ Document binding — links specific documents to individual agents."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AgentDocumentBinding(Base):
    """Maps which documents are assigned to a specific agent."""

    __tablename__ = "agent_document_bindings"
    __table_args__ = (
        UniqueConstraint("chat_agent_id", "document_id", name="uq_agent_document"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_agent_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chat_agents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    chat_agent: Mapped["ChatAgent"] = relationship("ChatAgent", back_populates="document_bindings")
    document: Mapped["Document"] = relationship("Document", back_populates="agent_bindings")
