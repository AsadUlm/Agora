"""
WebSocket connection manager.

Manages active WebSocket connections grouped into two subscription channels:

  - session channel  (session_id → set of WebSocket)
    For clients that want all events produced during a debate session.

  - turn channel     (turn_id → set of WebSocket)
    For clients that want fine-grained progress for one specific turn.

When the engine emits an ExecutionEvent, ws_manager.emit() broadcasts it
to subscribers on BOTH the matching session channel AND the turn channel.
This means a client subscribed to either channel receives all relevant events.

Dead connections (closed/errored) are silently pruned during broadcast.

Usage
-----
# Singleton — import and use everywhere:
from app.services.ws_manager import ws_manager

# In a WebSocket endpoint:
await ws_manager.connect_session(websocket, str(session_id))
try:
    while True:
        await websocket.receive_text()   # keep alive
except WebSocketDisconnect:
    pass
finally:
    ws_manager.disconnect_session(websocket, str(session_id))

# As the on_event callback for ChatEngine:
engine = ChatEngine(db, on_event=ws_manager.emit)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import DefaultDict, Set

from fastapi import WebSocket

from app.schemas.contracts import ExecutionEvent
from app.schemas.ws_payloads import serialize_event

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Singleton manager for WebSocket subscriptions and event broadcasting.

    Thread-safety note: designed for single-process, single-event-loop use.
    All operations are regular async — no locking needed within asyncio.
    """

    def __init__(self) -> None:
        # session_id (str) → set of active WebSocket connections
        self._session_subs: DefaultDict[str, Set[WebSocket]] = defaultdict(set)
        # turn_id (str) → set of active WebSocket connections
        self._turn_subs: DefaultDict[str, Set[WebSocket]] = defaultdict(set)

    # ── Connection lifecycle ─────────────────────────────────────────────────

    async def connect_session(self, ws: WebSocket, session_id: str) -> None:
        """Accept a WebSocket and register it on the session channel."""
        await ws.accept()
        self._session_subs[session_id].add(ws)
        logger.debug(
            "WS connected to session channel: session=%s total=%d",
            session_id,
            len(self._session_subs[session_id]),
        )

    async def connect_turn(self, ws: WebSocket, turn_id: str) -> None:
        """Accept a WebSocket and register it on the turn channel."""
        await ws.accept()
        self._turn_subs[turn_id].add(ws)
        logger.debug(
            "WS connected to turn channel: turn=%s total=%d",
            turn_id,
            len(self._turn_subs[turn_id]),
        )

    def disconnect_session(self, ws: WebSocket, session_id: str) -> None:
        """Remove a WebSocket from the session channel."""
        self._session_subs[session_id].discard(ws)
        logger.debug(
            "WS disconnected from session channel: session=%s remaining=%d",
            session_id,
            len(self._session_subs[session_id]),
        )

    def disconnect_turn(self, ws: WebSocket, turn_id: str) -> None:
        """Remove a WebSocket from the turn channel."""
        self._turn_subs[turn_id].discard(ws)
        logger.debug(
            "WS disconnected from turn channel: turn=%s remaining=%d",
            turn_id,
            len(self._turn_subs[turn_id]),
        )

    # ── Broadcasting ─────────────────────────────────────────────────────────

    async def emit(self, event: ExecutionEvent) -> None:
        """
        Broadcast an ExecutionEvent to all subscribers of the event's channels.

        Sends to:
          - All WebSockets subscribed to event.session_id (session channel)
          - All WebSockets subscribed to event.turn_id    (turn channel)

        Deduplicates so a client subscribed to both channels receives
        each event only once.

        Dead connections (WebSocketDisconnect, send errors) are silently
        removed. A disconnected client NEVER breaks debate execution.

        This method is the on_event callback passed to ChatEngine:
            engine = ChatEngine(db, on_event=ws_manager.emit)
        """
        session_key = str(event.session_id)
        turn_key = str(event.turn_id)

        # Collect unique targets across both channels
        targets: set[WebSocket] = set()
        targets.update(self._session_subs.get(session_key, set()))
        targets.update(self._turn_subs.get(turn_key, set()))

        if not targets:
            return

        payload = serialize_event(event)
        dead: set[WebSocket] = set()

        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)

        # Prune dead connections from both channels
        for ws in dead:
            self._session_subs[session_key].discard(ws)
            self._turn_subs[turn_key].discard(ws)
            logger.debug(
                "WS: pruned dead connection (session=%s / turn=%s)",
                session_key,
                turn_key,
            )

    @property
    def session_subscriber_count(self) -> int:
        """Total active session-channel connections (for monitoring)."""
        return sum(len(s) for s in self._session_subs.values())

    @property
    def turn_subscriber_count(self) -> int:
        """Total active turn-channel connections (for monitoring)."""
        return sum(len(s) for s in self._turn_subs.values())


# ── Module-level singleton ────────────────────────────────────────────────────
#
# Import and use this everywhere:
#   from app.services.ws_manager import ws_manager
#
ws_manager = WebSocketManager()
