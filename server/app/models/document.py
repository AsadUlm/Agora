import enum
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import BigInteger, DateTime, JSON, String, Text, Uuid, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DocumentStatus(str, enum.Enum):
    uploaded = "uploaded"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class Document(Base):
    """RAG storage: uploaded knowledge documents."""
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Step 30: file_path is now optional — Cloudinary-backed documents have
    # storage_public_id / storage_secure_url instead. Old local-storage rows
    # keep their on-disk path here for backward compat.
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True, default=None)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[DocumentStatus] = mapped_column(
        SQLEnum(DocumentStatus, name="document_status"), nullable=False, default=DocumentStatus.uploaded
    )

    # ── Step 30: storage provider metadata ──────────────────────────────────
    storage_provider: Mapped[str] = mapped_column(
        String(32), nullable=False, default="local", server_default="local"
    )
    storage_public_id: Mapped[str | None] = mapped_column(String(512), nullable=True, default=None)
    storage_url: Mapped[str | None] = mapped_column(String(1024), nullable=True, default=None)
    storage_secure_url: Mapped[str | None] = mapped_column(String(1024), nullable=True, default=None)
    storage_resource_type: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    storage_format: Mapped[str | None] = mapped_column(String(32), nullable=True, default=None)
    storage_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True, default=None)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)

    # ── Step 31: knowledge intelligence layer ───────────────────────────────
    # Coarse document type used by retrieval routing (policy_report, academic_paper,
    # technical_specification, legal_document, research_summary, news_article,
    # strategy_document, internal_notes, unknown).
    document_type: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    # 2–4 sentence compressed digest produced by the knowledge extractor.
    document_summary: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    # Structured payload: topics, claims, entities, risk_domains. Fail-soft —
    # absent until the extractor populates it; downstream code must use ``or {}``.
    knowledge_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, default=None
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
    document_chunks: Mapped[list["DocumentChunk"]] = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")
    agent_bindings: Mapped[list["AgentDocumentBinding"]] = relationship("AgentDocumentBinding", back_populates="document", cascade="all, delete-orphan")
