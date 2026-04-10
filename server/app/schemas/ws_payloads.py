"""
WebSocket payload serialization.

Converts internal ExecutionEvent objects into JSON-serializable dicts
suitable for transport over WebSocket connections.

Rules:
  - No raw ORM/SQLAlchemy objects are ever included
  - All UUIDs are serialized as strings
  - All datetimes are serialized as ISO-8601 strings
  - Payload shape is stable and frontend-renderable

This module is the single point of truth for what clients receive.
"""

from __future__ import annotations

from typing import Any

from app.schemas.contracts import ExecutionEvent


def serialize_event(event: ExecutionEvent) -> dict[str, Any]:
    """
    Serialize an ExecutionEvent for WebSocket transport.

    Produces a flat, frontend-friendly dict. All identifier fields are
    always present (None when not applicable), so the frontend does not
    need to guard for missing keys.

    Shape:
        {
            "type":         str,             // e.g. "turn_started"
            "session_id":   str,             // UUID
            "turn_id":      str,             // UUID
            "round_id":     str | null,      // UUID or null
            "round_number": int | null,
            "agent_id":     str | null,      // UUID or null
            "payload":      dict,            // event-specific data
            "timestamp":    str,             // ISO-8601
        }
    """
    return {
        "type": event.event_type.value,
        "session_id": str(event.session_id),
        "turn_id": str(event.turn_id),
        "round_id": str(event.round_id) if event.round_id is not None else None,
        "round_number": event.round_number,
        "agent_id": str(event.agent_id) if event.agent_id is not None else None,
        "payload": event.payload,
        "timestamp": event.timestamp.isoformat(),
    }
