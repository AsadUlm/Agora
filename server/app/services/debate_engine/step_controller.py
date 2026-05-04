"""
Step Controller — gates per-agent execution for manual ("step-by-step") mode.

The chat engine still runs as a single background task; we simply suspend it
between agents using an asyncio.Event registry keyed by turn_id.

Modes:
  - "auto"   → gate is permanently released; engine flows through all rounds
              with no extra latency (default, preserves existing behavior).
  - "manual" → engine awaits a release signal before each agent's _call_llm.
              The HTTP endpoint POST /debates/{id}/next-step releases one step.

This module is process-local (single-instance backend). For multi-worker
deployments a Redis-backed queue would replace it; the public API stays the same.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger(__name__)

ExecutionMode = Literal["auto", "manual"]


@dataclass
class _TurnState:
    mode: ExecutionMode = "auto"
    # asyncio.Event released for each granted step. In auto mode it stays
    # permanently set; in manual mode it is cleared after each acquire.
    gate: asyncio.Event = field(default_factory=asyncio.Event)
    # Snapshot of the step currently waiting on the gate (set by engine
    # before await; cleared after release). Used by the API to describe
    # "what is about to run" without polling the DB.
    pending_step: dict | None = None
    # Whether a step is currently executing (between gate release and the
    # next gate.wait()). Used for /next-step idempotency.
    is_running: bool = False


class StepController:
    """Process-local registry of per-turn execution gates."""

    def __init__(self) -> None:
        self._turns: dict[uuid.UUID, _TurnState] = {}
        self._lock = asyncio.Lock()

    async def register(self, turn_id: uuid.UUID, mode: ExecutionMode) -> None:
        """Initialize gate for a new turn. Auto mode pre-releases the gate."""
        async with self._lock:
            state = _TurnState(mode=mode)
            if mode == "auto":
                state.gate.set()
            self._turns[turn_id] = state
            logger.info("StepController: registered turn=%s mode=%s", turn_id, mode)

    async def wait_for_step(self, turn_id: uuid.UUID, step_meta: dict | None = None) -> None:
        """
        Engine calls this immediately before each agent's _call_llm.

        Auto mode → returns instantly.
        Manual mode → blocks until release_step() is called (or the turn is
        switched to auto via switch_mode(auto)).
        """
        state = self._turns.get(turn_id)
        if state is None:
            # No registration — fall back to auto (back-compat for tests
            # constructed without a controller).
            return
        state.pending_step = step_meta
        state.is_running = False
        if state.mode == "manual":
            logger.info(
                "StepController: turn=%s waiting (manual) step=%s",
                turn_id,
                step_meta,
            )
        await state.gate.wait()
        # In manual mode, single-shot the gate so the next step also waits.
        if state.mode == "manual":
            state.gate.clear()
        state.is_running = True
        state.pending_step = None

    async def release_step(self, turn_id: uuid.UUID) -> bool:
        """Release one step. Returns False if turn unknown or already running."""
        state = self._turns.get(turn_id)
        if state is None:
            return False
        if state.is_running:
            return False
        state.gate.set()
        return True

    async def switch_mode(self, turn_id: uuid.UUID, mode: ExecutionMode) -> bool:
        """Switch a running turn between auto and manual."""
        state = self._turns.get(turn_id)
        if state is None:
            return False
        state.mode = mode
        if mode == "auto":
            # Permanently release so subsequent waits are no-ops.
            state.gate.set()
        logger.info("StepController: turn=%s mode→%s", turn_id, mode)
        return True

    def snapshot(self, turn_id: uuid.UUID) -> dict | None:
        """Read-only view of current state for the API layer."""
        state = self._turns.get(turn_id)
        if state is None:
            return None
        return {
            "mode": state.mode,
            "is_running": state.is_running,
            "pending_step": state.pending_step,
            "gate_set": state.gate.is_set(),
        }

    async def cleanup(self, turn_id: uuid.UUID) -> None:
        """Drop state when a turn finishes/fails to avoid unbounded growth."""
        async with self._lock:
            self._turns.pop(turn_id, None)


# Process-wide singleton (mirrors ws_manager pattern).
step_controller = StepController()
