"""initial_schema

Revision ID: 0001
Revises:
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ──────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # ── chat_sessions ──────────────────────────────────────────────────────
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "archived", "deleted", name="chat_session_status"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_sessions_user_id"), "chat_sessions", ["user_id"], unique=False)

    # ── chat_agents ────────────────────────────────────────────────────────
    op.create_table(
        "chat_agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_session_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("role", sa.String(length=255), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("reasoning_style", sa.String(length=100), nullable=True),
        sa.Column("position_order", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_agents_chat_session_id"), "chat_agents", ["chat_session_id"], unique=False)

    # ── chat_turns ─────────────────────────────────────────────────────────
    op.create_table(
        "chat_turns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_session_id", sa.Uuid(), nullable=False),
        sa.Column("turn_index", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("queued", "running", "completed", "failed", "cancelled", name="chat_turn_status"),
            nullable=False,
        ),
        sa.Column("current_round_no", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_turns_chat_session_id"), "chat_turns", ["chat_session_id"], unique=False)

    # ── rounds ─────────────────────────────────────────────────────────────
    op.create_table(
        "rounds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_turn_id", sa.Uuid(), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column(
            "round_type",
            sa.Enum("initial", "critique", "final", name="round_type"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("started", "completed", "failed", name="round_status"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_turn_id"], ["chat_turns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rounds_chat_turn_id"), "rounds", ["chat_turn_id"], unique=False)

    # ── llm_calls ──────────────────────────────────────────────────────────
    op.create_table(
        "llm_calls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_turn_id", sa.Uuid(), nullable=False),
        sa.Column("round_id", sa.Uuid(), nullable=False),
        sa.Column("chat_agent_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("started", "success", "failed", name="llm_call_status"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_agent_id"], ["chat_agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_turn_id"], ["chat_turns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["round_id"], ["rounds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_llm_calls_chat_turn_id"), "llm_calls", ["chat_turn_id"], unique=False)
    op.create_index(op.f("ix_llm_calls_round_id"), "llm_calls", ["round_id"], unique=False)

    # ── messages ───────────────────────────────────────────────────────────
    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_session_id", sa.Uuid(), nullable=False),
        sa.Column("chat_turn_id", sa.Uuid(), nullable=False),
        sa.Column("round_id", sa.Uuid(), nullable=True),
        sa.Column("chat_agent_id", sa.Uuid(), nullable=True),
        sa.Column(
            "sender_type",
            sa.Enum("user", "agent", "judge", "system", name="sender_type"),
            nullable=False,
        ),
        sa.Column(
            "message_type",
            sa.Enum("user_input", "agent_response", "critique", "final_summary", "system_notice", name="message_type"),
            nullable=False,
        ),
        sa.Column(
            "visibility",
            sa.Enum("visible", "internal", name="message_visibility"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_agent_id"], ["chat_agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_turn_id"], ["chat_turns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["round_id"], ["rounds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_chat_session_id"), "messages", ["chat_session_id"], unique=False)
    op.create_index(op.f("ix_messages_chat_turn_id"), "messages", ["chat_turn_id"], unique=False)
    op.create_index(op.f("ix_messages_round_id"), "messages", ["round_id"], unique=False)

    # ── documents ──────────────────────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_session_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column(
            "status",
            sa.Enum("uploaded", "processing", "ready", "failed", name="document_status"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_documents_chat_session_id"), "documents", ["chat_session_id"], unique=False)

    # ── document_chunks ────────────────────────────────────────────────────
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_chunks_document_id"), "document_chunks", ["document_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_chunks_document_id"), table_name="document_chunks")
    op.drop_table("document_chunks")
    op.drop_index(op.f("ix_documents_chat_session_id"), table_name="documents")
    op.drop_table("documents")
    op.drop_index(op.f("ix_messages_round_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_chat_turn_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_chat_session_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_llm_calls_round_id"), table_name="llm_calls")
    op.drop_index(op.f("ix_llm_calls_chat_turn_id"), table_name="llm_calls")
    op.drop_table("llm_calls")
    op.drop_index(op.f("ix_rounds_chat_turn_id"), table_name="rounds")
    op.drop_table("rounds")
    op.drop_index(op.f("ix_chat_turns_chat_session_id"), table_name="chat_turns")
    op.drop_table("chat_turns")
    op.drop_index(op.f("ix_chat_agents_chat_session_id"), table_name="chat_agents")
    op.drop_table("chat_agents")
    op.drop_index(op.f("ix_chat_sessions_user_id"), table_name="chat_sessions")
    op.drop_table("chat_sessions")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    # Drop enums
    sa.Enum(name="document_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="message_visibility").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="message_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="sender_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="llm_call_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="round_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="round_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="chat_turn_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="chat_session_status").drop(op.get_bind(), checkfirst=True)
