"""
Background debate execution runner.

Entry point for executing a ChatTurn outside the HTTP request lifecycle.

Design contract
---------------
The HTTP route:
  1. Creates session / agents / turn / user message
  2. Calls ``await db.commit()`` explicitly (so data is visible before background starts)
  3. Schedules ``run_turn_background`` via FastAPI BackgroundTasks
  4. Returns 201 immediately with status="queued"

This module:
  1. Opens a DEDICATED AsyncSession (never reuses the request session)
  2. Delegates full execution to ChatEngine (which owns all DB lifecycle)
  3. Commits after the engine exits:
       - on success  → commits completed state
       - on failure  → ChatEngine has already flushed failed state; this commits it
  4. Falls back to a recovery session if even the commit fails (e.g. connection lost)
  5. Never propagates exceptions — a background task crash must not kill the process

DB session safety
-----------------
The request-scoped session from ``get_db`` is committed and closed by the time
FastAPI's BackgroundTasks run (after response body is sent, dependencies exit).
The background task therefore MUST open its own session via AsyncSessionLocal.

Double-emit guard
-----------------
ChatEngine already emits ``turn_failed`` in its own exception handler.
The runner does NOT re-emit to avoid duplicate client messages,
except in the rare case where the engine's DB commit itself fails
(recovery path uses  _force_fail_turn which emits once).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.schemas.contracts import ExecutionEvent, ExecutionEventType, OnEventCallback
from app.services.chat_engine import ChatEngine
from app.services.debate_engine.step_controller import step_controller

logger = logging.getLogger(__name__)


async def run_turn_background(
    turn_id: uuid.UUID,
    session_id: uuid.UUID,
    on_event: OnEventCallback,
    session_factory: Any = None,
) -> None:
    """
    Execute a debate turn asynchronously with a dedicated DB session.

    Called via FastAPI BackgroundTasks after initial resources are committed.

    Args:
        turn_id:         UUID of the ChatTurn to execute.
        session_id:      UUID of the parent ChatSession (needed for failure events).
        on_event:        Async callback for streaming execution events (ws_manager.emit).
        session_factory: Async session factory to use. Defaults to AsyncSessionLocal.
                         Override in tests by passing the test session factory.
    """
    factory = session_factory if session_factory is not None else AsyncSessionLocal
    logger.info("Background execution starting for turn %s", turn_id)

    execution_failed = False
    turn_obj: ChatTurn | None = None

    async with factory() as db:
        try:
            # Read execution_mode from the persisted turn so the StepController
            # is registered with the right gate semantics (auto vs manual).
            turn_row = await db.execute(
                select(ChatTurn).where(ChatTurn.id == turn_id)
            )
            turn_obj = turn_row.scalar_one_or_none()
            mode = (
                turn_obj.execution_mode
                if turn_obj is not None and turn_obj.execution_mode in ("auto", "manual")
                else "auto"
            )
            await step_controller.register(turn_id, mode)  # type: ignore[arg-type]

            engine = ChatEngine(db=db, on_event=on_event, step_controller=step_controller)
            await engine.start_turn_execution(turn_id)

        except Exception as exc:
            # If the engine fails before it can transition queued->failed,
            # we force that transition here so the UI never hangs in queued.
            execution_failed = True
            if turn_obj is not None and turn_obj.status in (
                ChatTurnStatus.queued,
                ChatTurnStatus.running,
            ):
                turn_obj.status = ChatTurnStatus.failed
                turn_obj.ended_at = datetime.now(timezone.utc)
                await db.flush()
                try:
                    await on_event(
                        ExecutionEvent(
                            event_type=ExecutionEventType.turn_failed,
                            session_id=session_id,
                            turn_id=turn_id,
                            payload={"error": str(exc)},
                        )
                    )
                except Exception:
                    pass
            logger.exception(
                "Turn %s execution raised (will commit failed state): %s",
                turn_id,
                exc,
            )

        # Commit regardless — success path saves completed state,
        # failure path saves the failed state the engine flushed.
        try:
            await db.commit()
            logger.info(
                "Turn %s committed (failed=%s)", turn_id, execution_failed
            )
        except Exception as commit_exc:
            logger.exception(
                "Turn %s: commit failed after execution: %s",
                turn_id,
                commit_exc,
            )
            await db.rollback()

            if execution_failed:
                # State is lost — attempt to mark failed via a fresh session
                # The engine's turn_failed event was already emitted; no double-emit.
                await _force_fail_turn(turn_id, session_id, on_event, factory)
            else:
                # Completed execution but commit failed — surface as failure
                await _force_fail_turn(turn_id, session_id, on_event, factory)

    # Drop the in-memory step state regardless of success/failure.
    await step_controller.cleanup(turn_id)


async def _force_fail_turn(
    turn_id: uuid.UUID,
    session_id: uuid.UUID,
    on_event: OnEventCallback,
    session_factory: Any,
) -> None:
    """
    Last-resort recovery: mark a turn as failed via a brand-new session.

    Called only when the primary session's commit itself failed, meaning
    even the engine's failed-state flush was lost.
    """
    marked_failed = False

    try:
        async with session_factory() as recovery_db:
            row = await recovery_db.execute(
                select(ChatTurn).where(ChatTurn.id == turn_id)
            )
            turn = row.scalar_one_or_none()
            if turn is not None and turn.status in (
                ChatTurnStatus.queued,
                ChatTurnStatus.running,
            ):
                turn.status = ChatTurnStatus.failed
                turn.ended_at = datetime.now(timezone.utc)
                await recovery_db.commit()
                marked_failed = True
                logger.warning(
                    "Force-failed turn %s via recovery session", turn_id
                )
    except Exception:
        logger.exception(
            "Recovery session also failed for turn %s — turn may remain 'running'",
            turn_id,
        )

    if marked_failed:
        # Notify clients only when we actually changed the DB state here.
        try:
            await on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.turn_failed,
                    session_id=session_id,
                    turn_id=turn_id,
                    payload={
                        "error": "Execution state could not be persisted due to a database error."
                    },
                )
            )
        except Exception:
            pass  # Clients may already be disconnected; that is expected
