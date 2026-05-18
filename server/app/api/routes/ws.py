"""
WebSocket endpoints for real-time debate execution streaming.

Endpoints
---------
WS /ws/chat-sessions/{session_id}
    Subscribe to ALL events produced during a debate session.
    Suitable for a session-level dashboard or replay view.

WS /ws/chat-turns/{turn_id}
    Subscribe to events scoped to one specific debate turn.
    The primary endpoint for the debate live-view page.

Both endpoints receive the same event stream (session + turn channels
are broadcast together in ws_manager.emit).

Authentication
--------------
WebSocket connections cannot send HTTP Authorization headers from browsers.
Pass a valid JWT access token as the ``token`` query parameter:

    ws://localhost:8000/ws/chat-turns/<turn_id>?token=<jwt>

Unauthenticated connections are rejected with close code 1008 (Policy Violation).

Event format (JSON)
-------------------
Every message sent to the client is a JSON object:

    {
        "type":         "turn_started" | "round_started" | "message_created" |
                        "round_completed" | "turn_completed" | "turn_failed",
        "session_id":   "<uuid>",
        "turn_id":      "<uuid>",
        "round_id":     "<uuid>" | null,
        "round_number": <int> | null,
        "agent_id":     "<uuid>" | null,
        "payload":      { ... event-specific data ... },
        "timestamp":    "<ISO-8601>"
    }

Important payload fields by event type:
    message_created:
        payload.message_id, payload.message_type, payload.sender_type,
        payload.content (JSON string from LLM), payload.sequence_no,
        payload.generation_status

    turn_failed:
        payload.error   (human-readable error description)

Keep-alive
----------
The server does not send periodic pings. The client may send any text frame
to keep the connection open; the server ignores the content.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.core.auth import get_ws_current_user
from app.models.user import User
from app.services.ws_manager import ws_manager

router = APIRouter()


@router.websocket("/chat-sessions/{session_id}")
async def ws_session(
    websocket: WebSocket,
    session_id: uuid.UUID,
    user: User = Depends(get_ws_current_user),
) -> None:
    """
    WebSocket: subscribe to all events for a chat session.

    Broadcasts turn_started, round_started, message_created,
    round_completed, turn_completed, and turn_failed events.

    The connection stays open until the client disconnects.
    Debate execution is NOT affected by client disconnections.
    """
    sid = str(session_id)
    await ws_manager.connect_session(websocket, sid)
    try:
        # Keep the connection alive; ignore any incoming text frames
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect_session(websocket, sid)


@router.websocket("/chat-turns/{turn_id}")
async def ws_turn(
    websocket: WebSocket,
    turn_id: uuid.UUID,
    user: User = Depends(get_ws_current_user),
) -> None:
    """
    WebSocket: subscribe to events for a specific debate turn.

    The primary subscription point for the debate progress view.
    Receives the same events as the session channel, scoped to this turn.

    Connect immediately after POST /debates/start returns (before background
    execution begins) to receive all events including turn_started.
    """
    tid = str(turn_id)
    await ws_manager.connect_turn(websocket, tid)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect_turn(websocket, tid)
