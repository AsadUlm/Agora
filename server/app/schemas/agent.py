"""Public-facing Pydantic schema for agent creation in a debate request."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class AgentCreate(BaseModel):
    """
    Represents one agent definition supplied in POST /debates/start.

    `role`   — Human-readable role label (e.g. "analyst", "critic", "ethicist").
    `config` — Raw nested configuration dict. Parsed into AgentConfig internally.
               Can be empty {} to use all defaults.
    `document_ids` — Optional list of document UUIDs to bind to this agent
                     (used when knowledge.mode == "assigned_docs_only").
    """

    role: str
    config: dict = {}
    document_ids: list[uuid.UUID] = Field(default_factory=list)
