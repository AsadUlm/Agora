"""Follow-up cycle runner.

Loads a turn that has already completed cycle 1, builds the cumulative debate
memory, allocates round numbers for the new cycle, then drives the three
follow-up rounds via RoundManager.

Designed to be invoked from a FastAPI BackgroundTasks; never propagates
exceptions to the caller.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.round import Round
from app.models.agent_document_binding import AgentDocumentBinding
from app.models.debate_follow_up import DebateFollowUp
from app.schemas.contracts import (
    AgentContext,
    ExecutionEvent,
    ExecutionEventType,
    OnEventCallback,
    TurnContext,
)
from app.services.debate_engine.debate_memory import (
    build_compact_cycle_summary,
    build_debate_memory,
)
from app.services.debate_engine.round_manager import RoundManager
from app.services.llm.provider_error_classifier import make_safe_error, UNKNOWN_ERROR

logger = logging.getLogger(__name__)


def _agent_to_ctx(agent: ChatAgent, doc_ids: list[uuid.UUID]) -> AgentContext:
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
        assigned_document_ids=doc_ids,
    )


async def run_followup_cycle(
    session_id: uuid.UUID,
    turn_id: uuid.UUID,
    cycle_number: int,
    follow_up_question: str,
    on_event: OnEventCallback,
    session_factory: Any | None = None,
) -> None:
    """Run a complete follow-up cycle (3 rounds) for an existing turn."""
    factory = session_factory or AsyncSessionLocal
    logger.info(
        "Follow-up cycle starting: session=%s turn=%s cycle=%d question=%r",
        session_id,
        turn_id,
        cycle_number,
        follow_up_question[:80],
    )

    async with factory() as db:
        try:
            # Build memory from current debate state
            memory_obj = await build_debate_memory(db, session_id)
            memory = memory_obj.to_dict()

            # Load turn + agents + bindings
            turn_row = await db.execute(
                select(ChatTurn)
                .where(ChatTurn.id == turn_id)
                .options(
                    selectinload(ChatTurn.chat_session)
                    .selectinload(ChatSession.chat_agents),
                    selectinload(ChatTurn.rounds),
                )
            )
            turn = turn_row.scalar_one_or_none()
            if turn is None:
                logger.error("Follow-up cycle aborted — turn %s not found.", turn_id)
                return

            agents = [a for a in turn.chat_session.chat_agents if a.is_active]
            if not agents:
                logger.error("Follow-up cycle aborted — no active agents.")
                return

            agent_ids = [a.id for a in agents]
            bindings_result = await db.execute(
                select(AgentDocumentBinding.chat_agent_id, AgentDocumentBinding.document_id)
                .where(AgentDocumentBinding.chat_agent_id.in_(agent_ids))
            )
            bindings_by_agent: dict[uuid.UUID, list[uuid.UUID]] = {}
            for row in bindings_result.all():
                bindings_by_agent.setdefault(row.chat_agent_id, []).append(row.document_id)

            # Allocate the next 3 round_numbers (cycle 2 → 4/5/6, cycle 3 → 7/8/9 …)
            existing_max = max((r.round_number for r in turn.rounds), default=0)
            round_a = existing_max + 1
            round_b = existing_max + 2
            round_c = existing_max + 3

            logger.info(
                "[FollowUp] previous context loaded session=%s turn=%s cycle=%d "
                "has_previous_synthesis=%s agent_count=%d has_rag_context=%s "
                "cycle_memories=%d evolution_count=%d",
                session_id,
                turn_id,
                cycle_number,
                bool(memory.get("previous_synthesis")),
                len(agents),
                any(bindings_by_agent.get(a.id) for a in agents),
                len(memory.get("cycle_memories") or []),
                len(memory.get("evolving_positions") or []),
            )

            # Reset turn status so the UI sees the cycle as live
            turn.status = ChatTurnStatus.running
            turn.ended_at = None
            await db.commit()

            await on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.turn_started,
                    session_id=session_id,
                    turn_id=turn_id,
                    payload={
                        "follow_up": True,
                        "cycle_number": cycle_number,
                        "follow_up_question": follow_up_question,
                        # FIX-12: surface RAG state for follow-up cycles too.
                        "rag_active": any(bindings_by_agent.get(a.id) for a in agents),
                        "document_count": len(
                            {d for ids in bindings_by_agent.values() for d in ids}
                        ),
                    },
                )
            )

            ctx = TurnContext(
                turn_id=turn.id,
                session_id=session_id,
                user_id=turn.chat_session.user_id,
                question=memory.get("original_question") or follow_up_question,
                agents=[_agent_to_ctx(a, bindings_by_agent.get(a.id, [])) for a in agents],
                turn_index=turn.turn_index,
                # FIX-12: surface RAG state so follow-up cycles also expose it.
                rag_active=any(bindings_by_agent.get(a.id) for a in agents),
                document_count=len({d for ids in bindings_by_agent.values() for d in ids}),
            )

            round_manager = RoundManager(
                db=db,
                # Use a fresh sequence start — keeps cycle 2 messages well above cycle 1
                seq_start=round_a * 1000,
                on_event=on_event,
                step_controller=None,
                session_factory=factory,
            )

            try:
                # Streaming overlap: launch the response stage and start the
                # critique stage as soon as ≥2 successful responses are ready.
                # The remaining response tasks finish concurrently with the
                # critique stage and are awaited via ``all_done_future`` before
                # running the updated synthesis.
                (
                    _resp_round,
                    ready_future,
                    all_done_future,
                ) = await round_manager.start_followup_response_streaming(
                    ctx,
                    cycle_number=cycle_number,
                    round_number=round_a,
                    follow_up_question=follow_up_question,
                    memory=memory,
                    min_ready=2,
                )

                ready_results = await ready_future
                logger.info(
                    "Follow-up response: %d ready (of %d) — starting critique now",
                    sum(1 for r in ready_results if r.generation_status == "success"),
                    len(ctx.agents),
                )

                # Run critique with the partial set of ready responses. Remaining
                # response tasks are still running and will finish in background.
                crit_task = asyncio.create_task(
                    round_manager.execute_followup_critique(
                        ctx,
                        cycle_number=cycle_number,
                        round_number=round_b,
                        follow_up_question=follow_up_question,
                        memory=memory,
                        followup_responses=ready_results,
                    )
                )
                resp = await all_done_future
                crit = await crit_task

                synth_results = await round_manager.execute_updated_synthesis(
                    ctx,
                    cycle_number=cycle_number,
                    round_number=round_c,
                    follow_up_question=follow_up_question,
                    memory=memory,
                    followup_responses=resp,
                    followup_critiques=crit,
                )

                # Persist a compact cycle_summary for use as compressed memory
                # in subsequent cycles.
                await _persist_cycle_summary(
                    db,
                    turn_id=turn_id,
                    cycle_number=cycle_number,
                    follow_up_question=follow_up_question,
                    synth_results=synth_results,
                )

                turn.status = ChatTurnStatus.completed
                turn.ended_at = datetime.now(timezone.utc)
                turn.current_round_no = round_c
                await db.commit()

                logger.info(
                    "[FollowUp] generation completed session=%s turn=%s cycle=%d "
                    "responses_ok=%d critiques_ok=%d synthesis_ok=%d",
                    session_id,
                    turn_id,
                    cycle_number,
                    sum(1 for r in resp if r.generation_status == "success"),
                    sum(1 for c in crit if c.generation_status == "success"),
                    sum(1 for s in synth_results if s.generation_status == "success"),
                )

                await on_event(
                    ExecutionEvent(
                        event_type=ExecutionEventType.turn_completed,
                        session_id=session_id,
                        turn_id=turn_id,
                        payload={"follow_up": True, "cycle_number": cycle_number},
                    )
                )

            except Exception as exc:
                safe_error = getattr(exc, "safe_error", None)
                if safe_error is None:
                    safe_error = make_safe_error(UNKNOWN_ERROR, message=str(exc))
                logger.warning(
                    "[FollowUp] generation failed: %s",
                    safe_error.message,
                    extra={
                        "debate_id": str(session_id),
                        "turn_id": str(turn_id),
                        "cycle_number": cycle_number,
                        "error_code": safe_error.code,
                        "retryable": safe_error.retryable,
                        "debug_id": safe_error.debug_id,
                    },
                )
                turn.status = ChatTurnStatus.failed
                turn.ended_at = datetime.now(timezone.utc)
                await db.commit()
                try:
                    await on_event(
                        ExecutionEvent(
                            event_type=ExecutionEventType.turn_failed,
                            session_id=session_id,
                            turn_id=turn_id,
                            payload={
                                "follow_up": True,
                                "cycle_number": cycle_number,
                                "error": str(exc),
                                "safe_error": safe_error.to_frontend_dict(),
                                "generation_failed": True,
                            },
                        )
                    )
                except Exception:  # noqa: BLE001
                    pass

        except Exception as exc:  # noqa: BLE001
            safe_error = getattr(exc, "safe_error", None)
            if safe_error is None:
                safe_error = make_safe_error(UNKNOWN_ERROR, message=str(exc))
            logger.warning(
                "[FollowUp] outer failure: %s",
                safe_error.message,
                extra={
                    "debate_id": str(session_id),
                    "turn_id": str(turn_id),
                    "cycle_number": cycle_number,
                    "error_code": safe_error.code,
                    "retryable": safe_error.retryable,
                    "debug_id": safe_error.debug_id,
                },
            )
            try:
                await on_event(
                    ExecutionEvent(
                        event_type=ExecutionEventType.turn_failed,
                        session_id=session_id,
                        turn_id=turn_id,
                        payload={
                            "follow_up": True,
                            "cycle_number": cycle_number,
                            "error": str(exc),
                            "safe_error": safe_error.to_frontend_dict(),
                            "generation_failed": True,
                        },
                    )
                )
            except Exception:
                pass


__all__ = ["run_followup_cycle"]


async def _persist_cycle_summary(
    db: Any,
    *,
    turn_id: uuid.UUID,
    cycle_number: int,
    follow_up_question: str,
    synth_results: list[Any],
) -> None:
    """Compute a compact cycle summary and persist it on the matching
    DebateFollowUp row. Failures are logged but never raised — the cycle is
    already complete by this point.
    """
    try:
        # Pick the first successful synthesis payload to summarize.
        payload: dict[str, Any] | None = None
        for r in synth_results:
            if getattr(r, "generation_status", "") == "success":
                payload = getattr(r, "structured", None)
                if isinstance(payload, dict):
                    break
        if not isinstance(payload, dict):
            return

        summary_text = build_compact_cycle_summary(
            cycle_number=cycle_number,
            question=follow_up_question,
            updated_synth_payload=payload,
        )
        if not summary_text:
            return

        from sqlalchemy import update as sa_update

        await db.execute(
            sa_update(DebateFollowUp)
            .where(
                DebateFollowUp.chat_turn_id == turn_id,
                DebateFollowUp.cycle_number == cycle_number,
            )
            .values(cycle_summary=summary_text)
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to persist cycle_summary for turn=%s cycle=%d",
            turn_id,
            cycle_number,
        )
