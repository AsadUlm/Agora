"""
Chat Engine — orchestrates a full 3-round debate turn.

This is the single entry point for turn execution.
Called by the API route after the Turn record has been created.

Responsibilities:
  - Load all required context from the database
  - Transition ChatTurn through its lifecycle (queued → running → completed/failed)
  - Delegate each round to RoundManager
  - Return a structured result dict for the API response

Design principle:
  The API route owns session/agent/turn CREATION and the user message.
  The ChatEngine owns EXECUTION: rounds, messages (per-agent), llm_calls, timestamps.

  This separation makes it straightforward to move execution to a background
  task (Celery, FastAPI BackgroundTasks, or asyncio.create_task) in Step 3
  without changing the engine itself.

Execution flow:
  start_turn_execution(turn_id)
    └── _load_turn()                        load ChatTurn + session + agents + messages
    └── _build_turn_context()              build TurnContext from ORM data
    └── turn.status = running
    └── RoundManager.execute_round_1()     Round 1
    └── RoundManager.execute_round_2()     Round 2
    └── RoundManager.execute_round_3()     Round 3
    └── turn.status = completed
    └── return result dict
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.message import MessageType
from app.models.agent_document_binding import AgentDocumentBinding
from app.schemas.contracts import AgentContext, AgentRoundResult, ExecutionEvent, ExecutionEventType, OnEventCallback, TurnContext
from app.services.debate_engine.round_manager import RoundManager
from app.services.debate_engine.lifecycle import FinalSynthesisFailed
from app.services.llm.provider_error_classifier import classify_provider_error, make_safe_error, UNKNOWN_ERROR

logger = logging.getLogger(__name__)


def _phase_for_stage(stage: int | None) -> str:
    return {
        1: "initial",
        2: "critique",
        3: "critique_response",
        4: "revised_position",
        5: "final_synthesis",
    }.get(stage or 1, "initial")


class ChatEngine:
    """
    Synchronous (blocking within the request) debate turn executor.

    Usage (sync, Step 2):
        engine = ChatEngine(db)
        result = await engine.start_turn_execution(turn_id)

    Usage (async + streaming, Step 3):
        engine = ChatEngine(db, on_event=ws_broadcast_fn)
        asyncio.create_task(engine.start_turn_execution(turn_id))

    The `on_event` callback receives ExecutionEvent objects at every lifecycle
    transition (turn_started, round_started, agent_completed, turn_completed, …).
    When None (default), the engine runs silently — no change to synchronous behavior.
    """

    def __init__(
        self,
        db: AsyncSession,
        on_event: OnEventCallback | None = None,
        step_controller: Any = None,
        session_factory: Any = None,
    ) -> None:
        self.db = db
        self._on_event = on_event
        self._step_controller = step_controller
        self._session_factory = session_factory

    async def start_turn_execution(self, turn_id: uuid.UUID) -> dict[str, Any]:
        """
        Execute a complete 3-round debate turn.

        Args:
            turn_id: UUID of the ChatTurn to execute. Must already exist in DB
                     with status 'queued'. The user question message must be
                     saved before calling this method.

        Returns:
            Dict with keys:
              "round1": list[dict]  — per-agent opening statements
              "round2": list[dict]  — per-agent critiques
              "round3": list[dict]  — per-agent final synthesis

        Raises:
            ValueError: If turn_id not found or session has no active agents.
            Exception:  Any unrecoverable error — turn is marked 'failed' before re-raising.
        """
        turn = await self._load_turn(turn_id)
        ctx = await self._build_turn_context(turn)

        # ── Service-level agent count guard ──────────────────────────────────
        from app.core.config import settings
        if len(ctx.agents) > settings.MAX_DEBATE_AGENTS:
            raise ValueError(
                f"Debate execution rejected: {len(ctx.agents)} agents exceeds "
                f"the maximum of {settings.MAX_DEBATE_AGENTS}."
            )

        # ── Transition: queued → running ─────────────────────────────────────
        turn.status = ChatTurnStatus.running
        turn.synthesis_status = "pending"
        turn.error_metadata = None
        turn.started_at = datetime.now(timezone.utc)
        turn.current_round_no = 1
        await self.db.flush()
        logger.info("Turn %s started: question=%r agents=%d", turn_id, ctx.question[:60], len(ctx.agents))
        logger.info("WS emit turn_started turn=%s", turn_id)
        await self._emit(ExecutionEvent(
            event_type=ExecutionEventType.turn_started,
            session_id=ctx.session_id,
            turn_id=ctx.turn_id,
            payload={
                # FIX-12: surface RAG state to the UI. ``rag_active=False`` is
                # a normal mode (reasoning-only) — never an error.
                "rag_active": ctx.rag_active,
                "document_count": ctx.document_count,
            },
        ))

        # ── Execute rounds via RoundManager ────────────────────────────────────
        round_manager = RoundManager(
            db=self.db,
            seq_start=1,
            on_event=self._on_event,
            step_controller=self._step_controller,
            session_factory=self._session_factory,
        )

        r1: list[AgentRoundResult] = []
        r2: list[AgentRoundResult] = []
        r3: list[AgentRoundResult] = []
        r4: list[AgentRoundResult] = []
        r5: list[AgentRoundResult] = []

        try:
            # Round 1 — Initial Positions
            r1: list[AgentRoundResult] = await round_manager.execute_round_1(ctx)
            turn.current_round_no = 2
            await self.db.flush()

            # Round 2 — Cross-Critiques
            r2: list[AgentRoundResult] = await round_manager.execute_round_2(ctx, r1)
            turn.current_round_no = 3
            await self.db.flush()

            # Round 3 — Critique Responses (Stage 3 of 5-stage traceable pipeline)
            r3: list[AgentRoundResult] = await round_manager.execute_round_critique_response(
                ctx, round_number=3, round1_results=r1, round2_results=r2
            )
            turn.current_round_no = 4
            await self.db.flush()

            # Round 4 — Revised Positions (Stage 4 of 5-stage traceable pipeline)
            r4: list[AgentRoundResult] = await round_manager.execute_round_revised_position(
                ctx, round_number=4, round1_results=r1, round2_results=r2, round3_results=r3
            )
            turn.current_round_no = 5
            await self.db.flush()

            # Round 5 — Final Synthesis (uses revised positions from Round 4)
            turn.synthesis_status = "running"
            await self.db.flush()
            r5: list[AgentRoundResult] = await round_manager.execute_round_final(
                ctx, round1_results=r1, round2_results=r2, revised_results=r4
            )
            turn.synthesis_status = "completed"

            # ── Transition: running → completed ───────────────────────────────
            turn.status = ChatTurnStatus.completed
            turn.ended_at = datetime.now(timezone.utc)
            turn.current_round_no = 5
            await self.db.flush()

            logger.info("Turn %s completed successfully (5-stage pipeline).", turn_id)
            logger.info("WS emit turn_completed turn=%s", turn_id)
            await self._emit(ExecutionEvent(
                event_type=ExecutionEventType.turn_completed,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
            ))

        except FinalSynthesisFailed as exc:
            exc.safe_error.request_id = turn.request_id
            turn.status = ChatTurnStatus.partially_completed
            turn.synthesis_status = "failed"
            turn.ended_at = datetime.now(timezone.utc)
            turn.error_metadata = exc.safe_error.to_frontend_dict()
            await self.db.flush()
            logger.exception(
                "Turn %s partially completed: final synthesis failed.",
                turn_id,
            )
            await self._emit(ExecutionEvent(
                event_type=ExecutionEventType.turn_partially_completed,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                payload={
                    "safe_error": exc.safe_error.to_frontend_dict(),
                    "partial_results_available": True,
                },
            ))

        except Exception as exc:
            # ── Transition: running → failed ──────────────────────────────────
            turn.status = ChatTurnStatus.failed
            if turn.synthesis_status != "completed":
                turn.synthesis_status = "skipped"
            turn.ended_at = datetime.now(timezone.utc)
            logger.exception("Turn %s failed: %s", turn_id, exc)
            # Build a safe error — classify if we have provider error info
            safe_error = getattr(exc, "safe_error", None)
            if safe_error is None:
                safe_error = make_safe_error(
                    UNKNOWN_ERROR,
                    message=str(exc),
                    severity="fatal",
                    phase=_phase_for_stage(turn.current_round_no),
                    partial_results_available=False,
                    request_id=turn.request_id,
                    last_successful_stage=max(0, (turn.current_round_no or 1) - 1),
                )
            else:
                safe_error.request_id = turn.request_id
            turn.error_metadata = safe_error.to_frontend_dict()
            await self.db.flush()
            await self._emit(ExecutionEvent(
                event_type=ExecutionEventType.turn_failed,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                payload={
                    "error": str(exc),
                    "safe_error": safe_error.to_frontend_dict(),
                    "generation_failed": True,
                },
            ))
            raise

        # ── Serialize results ─────────────────────────────────────────────────
        return {
            "round1": [_serialize_result(r) for r in r1],
            "round2": [_serialize_result(r) for r in r2],
            "round3": [_serialize_result(r) for r in r3],
            "round4": [_serialize_result(r) for r in r4],
            "round5": [_serialize_result(r) for r in r5],
        }
    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    async def _load_turn(self, turn_id: uuid.UUID) -> ChatTurn:
        """Load ChatTurn with its session, agents, and existing messages."""
        stmt = (
            select(ChatTurn)
            .where(ChatTurn.id == turn_id)
            .options(
                selectinload(ChatTurn.chat_session).selectinload(ChatSession.chat_agents),
                selectinload(ChatTurn.messages),
            )
        )
        result = await self.db.execute(stmt)
        turn = result.scalar_one_or_none()
        if turn is None:
            raise ValueError(f"ChatTurn {turn_id} not found.")
        return turn

    async def _build_turn_context(self, turn: ChatTurn) -> TurnContext:
        """Build the internal TurnContext from ORM objects."""
        session = turn.chat_session
        active_agents: list[ChatAgent] = [a for a in session.chat_agents if a.is_active]

        if not active_agents:
            raise ValueError(
                f"ChatSession {session.id} has no active agents. Cannot execute turn."
            )

        # Load document bindings for all agents in one query
        from sqlalchemy import select  # noqa: PLC0415
        agent_ids = [a.id for a in active_agents]
        bindings_result = await self.db.execute(
            select(AgentDocumentBinding.chat_agent_id, AgentDocumentBinding.document_id)
            .where(AgentDocumentBinding.chat_agent_id.in_(agent_ids))
        )
        bindings_by_agent: dict[uuid.UUID, list[uuid.UUID]] = {}
        for row in bindings_result.all():
            bindings_by_agent.setdefault(row.chat_agent_id, []).append(row.document_id)

        # The user question lives in a Message with message_type=user_input
        question = ""
        for msg in turn.messages:
            if msg.message_type == MessageType.user_input:
                question = msg.content
                break

        if not question:
            logger.warning(
                "Turn %s has no user_input message. Using empty question.", turn.id
            )

        return TurnContext(
            turn_id=turn.id,
            session_id=session.id,
            user_id=session.user_id,
            question=question,
            agents=[
                _agent_to_ctx(a, bindings_by_agent.get(a.id, []))
                for a in active_agents
            ],
            turn_index=turn.turn_index,
            # FIX-12: surface RAG state so the UI can render a neutral
            # "Reasoning-only mode" indicator when no documents are attached.
            # No documents is a valid mode — never treated as an error.
            rag_active=any(bindings_by_agent.get(a.id) for a in active_agents),
            document_count=len({d for ids in bindings_by_agent.values() for d in ids}),
        )

    async def _emit(self, event: ExecutionEvent) -> None:
        """
        Emit a lifecycle event to the registered callback (if any).

        During synchronous execution (Step 2) this is a no-op unless a
        callback is provided. In Step 3, the route will wire in a WebSocket
        broadcast function:

            engine = ChatEngine(db, on_event=ws_manager.broadcast)
        """
        if self._on_event is not None:
            try:
                # Event streaming must never block debate execution.
                await asyncio.wait_for(self._on_event(event), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warning(
                    "Event emit timed out for turn=%s type=%s",
                    event.turn_id,
                    event.event_type.value,
                )
            except Exception:
                logger.exception(
                    "Event emit failed for turn=%s type=%s",
                    event.turn_id,
                    event.event_type.value,
                )


# ─────────────────────────────────────────────────────────────────────────────
# Module-level helpers
# ─────────────────────────────────────────────────────────────────────────────

def _agent_to_ctx(agent: ChatAgent, assigned_doc_ids: list[uuid.UUID] | None = None) -> AgentContext:
    return AgentContext(
        agent_id=agent.id,
        role=agent.role,
        provider=agent.provider,
        model=agent.model,
        temperature=float(agent.temperature) if agent.temperature is not None else 0.7,
        reasoning_style=agent.reasoning_style or "balanced",
        reasoning_depth=getattr(agent, "reasoning_depth", None) or "normal",
        knowledge_mode=agent.knowledge_mode or "shared_session_docs",
        knowledge_strict=agent.knowledge_strict if agent.knowledge_strict is not None else False,
        assigned_document_ids=assigned_doc_ids or [],
    )


def _serialize_result(result: AgentRoundResult) -> dict[str, Any]:
    """Convert AgentRoundResult to a plain dict for the API response."""
    out: dict[str, Any] = {
        "agent_id": str(result.agent_id),
        "role": result.role,
        "generation_status": result.generation_status,
    }
    # Merge structured fields directly into the top level for clean API output
    out.update(result.structured)
    if result.error:
        out["error"] = result.error
    return out
