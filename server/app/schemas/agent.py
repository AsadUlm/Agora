"""Public-facing Pydantic schema for agent creation in a debate request."""

from __future__ import annotations

from pydantic import BaseModel


class AgentCreate(BaseModel):
    """
    Represents one agent definition supplied in POST /debates/start.

    `role`   — Human-readable role label (e.g. "analyst", "critic", "ethicist").
    `config` — Raw nested configuration dict. Parsed into AgentConfig internally.
               Can be empty {} to use all defaults.
    """

    role: str
    config: dict = {}
