"""Agent preset — reusable user-owned or built-in agent configuration."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AgentPreset(Base):
    """Reusable agent configuration template (a.k.a. preset).

    System presets are persisted with a stable ``system_key`` and no owner.
    User-created presets remain owner-scoped and never receive a system key.
    """

    __tablename__ = "agent_presets"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    system_key: Mapped[str | None] = mapped_column(
        String(80), nullable=True, unique=True, index=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Visibility: "private" | "shared" | "system".
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default="private"
    )

    role_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reasoning_style: Mapped[str] = mapped_column(String(80), nullable=False)
    reasoning_depth: Mapped[str] = mapped_column(String(40), nullable=False)

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    model_preset: Mapped[str | None] = mapped_column(String(40), nullable=True)
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)

    # RAG / knowledge — mirrors ChatAgent.knowledge_mode values.
    rag_mode: Mapped[str] = mapped_column(
        String(40), nullable=False, default="shared_session_docs"
    )
    document_ids: Mapped[list[str]] = mapped_column(
        JSON().with_variant(ARRAY(String), "postgresql"),
        nullable=False,
        default=list,
        server_default="{}",
    )
    strict_grounding: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

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

    user = relationship("User")
