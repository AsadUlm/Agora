"""Follow-up cycle runner.

Loads a turn that has already completed cycle 1, builds the cumulative debate
memory, allocates round numbers for the new cycle, then drives the expanded
five-stage follow-up pipeline via RoundManager.

Designed to be invoked from a FastAPI BackgroundTasks; never propagates
exceptions to the caller.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn, ChatTurnStatus
from app.models.round import Round, RoundStatus, RoundType
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
from app.services.llm.provider_error_classifier import (
    FINAL_SYNTHESIS_FAILED,
    FOLLOWUP_PARTIAL_COMPLETION,
    UNKNOWN_ERROR,
    DebateSafeError,
    make_safe_error,
)

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class FollowupCycleOutcome:
    """Persisted terminal state derived from one follow-up cycle's records."""

    status: ChatTurnStatus
    response_count: int
    critique_count: int
    synthesis_count: int
    missing_stages: tuple[str, ...]
    safe_error: DebateSafeError | None = None


def _message_is_usable(message: Any) -> bool:
    content = str(getattr(message, "content", "") or "").strip()
    if not content:
        return False
    try:
        payload = json.loads(content)
    except (TypeError, json.JSONDecodeError):
        return True
    if not isinstance(payload, dict):
        return True
    return payload.get("generation_status") not in {"failed", "skipped"}


def _usable_message_count(rounds: list[Round], round_types: set[RoundType]) -> int:
    return sum(
        1
        for round_record in rounds
        if round_record.round_type in round_types
        for message in round_record.messages
        if _message_is_usable(message)
    )


async def _recover_after_optional_stage_failure(
    db: Any,
    turn: ChatTurn,
    *,
    stage_name: str,
) -> None:
    """Restore the runner session after a degradable exchange-stage failure.

    A failed flush, such as a database enum mismatch, leaves SQLAlchemy's
    session unusable until rollback. Without this recovery, later optional
    stages and the required updated synthesis fail even when usable follow-up
    responses were already persisted by their worker sessions.
    """

    await db.rollback()
    await db.refresh(turn)
    logger.info(
        "[FollowUp] transaction recovered after degraded stage=%s turn=%s",
        stage_name,
        turn.id,
    )


async def reconcile_followup_status(
    *,
    turn_id: uuid.UUID,
    cycle_number: int,
    session_factory: Any | None = None,
    safe_error: DebateSafeError | None = None,
) -> FollowupCycleOutcome:
    """Force a follow-up cycle into a truthful terminal persisted state.

    This is deliberately based on persisted rounds/messages rather than the
    last in-memory runner step. It is the final guard against a background task
    exiting while the reused turn or one of its rounds still says ``running``.
    """

    factory = session_factory or AsyncSessionLocal
    async with factory() as db:
        row = await db.execute(
            select(ChatTurn)
            .where(ChatTurn.id == turn_id)
            .options(selectinload(ChatTurn.rounds).selectinload(Round.messages))
            .execution_options(populate_existing=True)
        )
        turn = row.scalar_one_or_none()
        if turn is None:
            return FollowupCycleOutcome(
                status=ChatTurnStatus.failed,
                response_count=0,
                critique_count=0,
                synthesis_count=0,
                missing_stages=("followup_response", "updated_synthesis"),
                safe_error=safe_error,
            )

        cycle_rounds = sorted(
            [r for r in turn.rounds if (r.cycle_number or 1) == cycle_number],
            key=lambda r: r.round_number,
        )
        now = datetime.now(timezone.utc)

        # No follow-up task is active once reconciliation runs. Close stale
        # active rounds according to whether they persisted anything useful.
        for round_record in cycle_rounds:
            if round_record.status in {RoundStatus.queued, RoundStatus.running}:
                round_record.status = (
                    RoundStatus.partially_completed
                    if any(_message_is_usable(m) for m in round_record.messages)
                    else RoundStatus.failed
                )
                round_record.ended_at = now

        response_count = _usable_message_count(
            cycle_rounds, {RoundType.followup_response}
        )
        critique_count = _usable_message_count(
            cycle_rounds,
            {RoundType.followup_critique, RoundType.followup_cross_critique},
        )
        synthesis_count = _usable_message_count(
            cycle_rounds, {RoundType.updated_synthesis}
        )

        round_types = {r.round_type for r in cycle_rounds}
        uses_expanded_pipeline = bool(
            round_types
            & {
                RoundType.followup_cross_critique,
                RoundType.followup_response_to_critique,
                RoundType.followup_revised_position,
            }
        )
        required_types = {
            RoundType.followup_response,
            RoundType.updated_synthesis,
        }
        required_types.add(
            RoundType.followup_cross_critique
            if uses_expanded_pipeline
            else RoundType.followup_critique
        )
        if uses_expanded_pipeline:
            required_types.update(
                {
                    RoundType.followup_response_to_critique,
                    RoundType.followup_revised_position,
                }
            )

        missing_stages = tuple(
            round_type.value
            for round_type in sorted(required_types, key=lambda item: item.value)
            if round_type not in round_types
            or not any(
                r.round_type == round_type
                and r.status in {RoundStatus.completed, RoundStatus.partially_completed}
                for r in cycle_rounds
            )
        )
        has_failed_round = any(r.status == RoundStatus.failed for r in cycle_rounds)
        has_partial_round = any(
            r.status == RoundStatus.partially_completed for r in cycle_rounds
        )

        if synthesis_count > 0:
            terminal_status = (
                ChatTurnStatus.completed
                if response_count >= 2
                and not missing_stages
                and not has_failed_round
                and not has_partial_round
                else ChatTurnStatus.partially_completed
            )
        elif response_count > 0:
            terminal_status = ChatTurnStatus.partially_completed
        else:
            terminal_status = ChatTurnStatus.failed

        if terminal_status != ChatTurnStatus.completed and safe_error is None:
            safe_error = make_safe_error(
                (
                    FOLLOWUP_PARTIAL_COMPLETION
                    if synthesis_count > 0
                    else FINAL_SYNTHESIS_FAILED
                    if response_count > 0
                    else UNKNOWN_ERROR
                ),
                message=(
                    "Follow-up cycle completed with an updated synthesis and partial exchange data."
                    if synthesis_count > 0
                    else "Follow-up cycle ended without an updated synthesis."
                    if response_count > 0
                    else "Follow-up cycle ended without usable agent responses."
                ),
                cycle_number=cycle_number,
                severity=(
                    "partial"
                    if terminal_status == ChatTurnStatus.partially_completed
                    else "fatal"
                ),
                phase="follow_up",
                partial_results_available=response_count > 0,
                request_id=turn.request_id,
                last_successful_stage=max(
                    (r.round_number for r in cycle_rounds if r.status != RoundStatus.failed),
                    default=None,
                ),
            )
        elif terminal_status == ChatTurnStatus.partially_completed and safe_error is not None:
            safe_error.severity = "partial"
            safe_error.partial_results_available = True
            safe_error.cycle_number = cycle_number

        turn.status = terminal_status
        turn.ended_at = now
        turn.current_round_no = max(
            (r.round_number for r in cycle_rounds),
            default=turn.current_round_no,
        )
        turn.synthesis_status = "completed" if synthesis_count > 0 else "failed"
        turn.error_metadata = (
            None if terminal_status == ChatTurnStatus.completed
            else safe_error.to_frontend_dict() if safe_error is not None
            else None
        )
        await db.commit()

        outcome = FollowupCycleOutcome(
            status=terminal_status,
            response_count=response_count,
            critique_count=critique_count,
            synthesis_count=synthesis_count,
            missing_stages=missing_stages,
            safe_error=safe_error,
        )
        logger.info(
            "[FollowUp] reconciled turn=%s cycle=%d status=%s responses=%d "
            "critiques=%d synthesis=%d missing=%s",
            turn_id,
            cycle_number,
            outcome.status.value,
            response_count,
            critique_count,
            synthesis_count,
            list(missing_stages),
        )
        return outcome


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
    response_language_code: str = "en",
    response_language_name: str = "English",
    response_language_source: str = "fallback",
    response_language_confidence: float = 0.6,
) -> None:
    """Run and terminally reconcile one expanded follow-up cycle."""
    factory = session_factory or AsyncSessionLocal
    terminal_error: DebateSafeError | None = None
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

            # Allocate the next 5 round_numbers (cycle 2 → 4/5/6/7/8, cycle 3 → 9/10/11/12/13 …)
            existing_max = max((r.round_number for r in turn.rounds), default=0)
            round_a = existing_max + 1
            round_b = existing_max + 2
            round_c = existing_max + 3
            round_d = existing_max + 4
            round_e = existing_max + 5

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
            turn.synthesis_status = "pending"
            turn.error_metadata = None
            await db.commit()

            await on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.turn_started,
                    session_id=session_id,
                    turn_id=turn_id,
                    payload={
                        "follow_up": True,
                        "cycle_number": cycle_number,
                        "status": ChatTurnStatus.running.value,
                        "follow_up_question": follow_up_question,
                        # FIX-12: surface RAG state for follow-up cycles too.
                        "rag_active": any(bindings_by_agent.get(a.id) for a in agents),
                        "document_count": len(
                            {d for ids in bindings_by_agent.values() for d in ids}
                        ),
                        "response_language_code": response_language_code,
                        "response_language_name": response_language_name,
                        "response_language_source": response_language_source,
                        "response_language_confidence": response_language_confidence,
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
                response_language_code=response_language_code,
                response_language_name=response_language_name,
                response_language_source=response_language_source,
                response_language_confidence=response_language_confidence,
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
                # The streaming response helper persists per-agent results as
                # they arrive; this runner waits for the persisted response
                # round before starting the optional exchange stages.
                (
                    _resp_round,
                    _ready_future,
                    all_done_future,
                ) = await round_manager.start_followup_response_streaming(
                    ctx,
                    cycle_number=cycle_number,
                    round_number=round_a,
                    follow_up_question=follow_up_question,
                    memory=memory,
                    # One usable response is enough to produce a partial updated
                    # synthesis. More responses improve the terminal status.
                    min_ready=1,
                )

                resp = await all_done_future

                crit: list[Any] = []
                crit_resp: list[Any] = []
                rev_pos: list[Any] = []

                # The expanded exchange enriches the answer, but it must not
                # prevent synthesis when persisted follow-up responses exist.
                try:
                    crit = await round_manager.execute_followup_critique(
                        ctx,
                        cycle_number=cycle_number,
                        round_number=round_b,
                        follow_up_question=follow_up_question,
                        memory=memory,
                        followup_responses=resp,
                    )
                except Exception as exc:  # noqa: BLE001
                    terminal_error = getattr(exc, "safe_error", None) or make_safe_error(
                        FOLLOWUP_PARTIAL_COMPLETION,
                        message=(
                            "Follow-up cross-critiques did not complete. "
                            "Updated synthesis continued with available responses."
                        ),
                        cycle_number=cycle_number,
                        severity="partial",
                        phase="follow_up_critique",
                        partial_results_available=True,
                    )
                    await _recover_after_optional_stage_failure(
                        db,
                        turn,
                        stage_name="followup_cross_critique",
                    )
                    logger.warning(
                        "[FollowUp] critique stage degraded; synthesis will use available responses",
                        exc_info=True,
                    )

                # Stage 2.2: Responses to Follow-up Critiques (Round C)
                try:
                    crit_resp = await round_manager.execute_followup_response_to_critique(
                        ctx,
                        cycle_number=cycle_number,
                        round_number=round_c,
                        follow_up_question=follow_up_question,
                        memory=memory,
                        followup_responses=resp,
                        followup_critiques=crit,
                    )
                except Exception as exc:  # noqa: BLE001
                    terminal_error = (
                        terminal_error
                        or getattr(exc, "safe_error", None)
                        or make_safe_error(
                            FOLLOWUP_PARTIAL_COMPLETION,
                            message=(
                                "Responses to follow-up critiques did not complete. "
                                "Updated synthesis continued with available responses."
                            ),
                            cycle_number=cycle_number,
                            severity="partial",
                            phase="follow_up_response_to_critique",
                            partial_results_available=True,
                        )
                    )
                    await _recover_after_optional_stage_failure(
                        db,
                        turn,
                        stage_name="followup_response_to_critique",
                    )
                    logger.warning(
                        "[FollowUp] critique-response stage degraded; synthesis will continue",
                        exc_info=True,
                    )

                # Stage 2.3: Revised Follow-up Positions (Round D)
                try:
                    rev_pos = await round_manager.execute_followup_revised_position(
                        ctx,
                        cycle_number=cycle_number,
                        round_number=round_d,
                        follow_up_question=follow_up_question,
                        memory=memory,
                        followup_responses=resp,
                        followup_critiques=crit,
                        followup_critique_responses=crit_resp,
                    )
                except Exception as exc:  # noqa: BLE001
                    terminal_error = (
                        terminal_error
                        or getattr(exc, "safe_error", None)
                        or make_safe_error(
                            FOLLOWUP_PARTIAL_COMPLETION,
                            message=(
                                "Revised follow-up positions did not complete. "
                                "Updated synthesis continued with available responses."
                            ),
                            cycle_number=cycle_number,
                            severity="partial",
                            phase="follow_up_revised_position",
                            partial_results_available=True,
                        )
                    )
                    await _recover_after_optional_stage_failure(
                        db,
                        turn,
                        stage_name="followup_revised_position",
                    )
                    logger.warning(
                        "[FollowUp] revised-position stage degraded; synthesis will continue",
                        exc_info=True,
                    )

                # Stage 3: Updated Synthesis (Round E)
                logger.info(
                    "[FollowUp] starting synthesis stage: round_e=%d "
                    "resp_count=%d (ok=%d) crit_count=%d (ok=%d) "
                    "crit_resp_count=%d (ok=%d) rev_pos_count=%d (ok=%d)",
                    round_e,
                    len(resp), sum(1 for r in resp if r.generation_status == "success"),
                    len(crit), sum(1 for c in crit if c.generation_status == "success"),
                    len(crit_resp), sum(1 for cr in crit_resp if cr.generation_status == "success"),
                    len(rev_pos), sum(1 for rp in rev_pos if rp.generation_status == "success"),
                )
                turn.current_round_no = round_e
                turn.synthesis_status = "running"
                await db.commit()
                synth_results = await round_manager.execute_updated_synthesis(
                    ctx,
                    cycle_number=cycle_number,
                    round_number=round_e,
                    follow_up_question=follow_up_question,
                    memory=memory,
                    followup_responses=resp,
                    followup_critiques=crit,
                    followup_revised_positions=rev_pos,
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

                logger.info(
                    "[FollowUp] generation completed session=%s turn=%s cycle=%d "
                    "responses_ok=%d critiques_ok=%d critique_responses_ok=%d revisions_ok=%d synthesis_ok=%d",
                    session_id,
                    turn_id,
                    cycle_number,
                    sum(1 for r in resp if r.generation_status == "success"),
                    sum(1 for c in crit if c.generation_status == "success"),
                    sum(1 for cr in crit_resp if cr.generation_status == "success"),
                    sum(1 for rp in rev_pos if rp.generation_status == "success"),
                    sum(1 for s in synth_results if s.generation_status == "success"),
                )

            except Exception as exc:
                terminal_error = getattr(exc, "safe_error", None)
                if terminal_error is None:
                    terminal_error = make_safe_error(
                        UNKNOWN_ERROR,
                        message=str(exc),
                        cycle_number=cycle_number,
                        phase="follow_up",
                    )
                logger.warning(
                    "[FollowUp] generation failed: %s (type=%s)",
                    terminal_error.message,
                    type(exc).__name__,
                    exc_info=True,
                    extra={
                        "debate_id": str(session_id),
                        "turn_id": str(turn_id),
                        "cycle_number": cycle_number,
                        "error_code": terminal_error.code,
                        "retryable": terminal_error.retryable,
                        "debug_id": terminal_error.debug_id,
                    },
                )

        except Exception as exc:  # noqa: BLE001
            terminal_error = getattr(exc, "safe_error", None)
            if terminal_error is None:
                terminal_error = make_safe_error(
                    UNKNOWN_ERROR,
                    message=str(exc),
                    cycle_number=cycle_number,
                    phase="follow_up",
                )
            logger.warning(
                "[FollowUp] outer failure: %s",
                terminal_error.message,
                extra={
                    "debate_id": str(session_id),
                    "turn_id": str(turn_id),
                    "cycle_number": cycle_number,
                    "error_code": terminal_error.code,
                    "retryable": terminal_error.retryable,
                    "debug_id": terminal_error.debug_id,
                },
            )
        finally:
            try:
                outcome = await reconcile_followup_status(
                    turn_id=turn_id,
                    cycle_number=cycle_number,
                    session_factory=factory,
                    safe_error=terminal_error,
                )
                event_type = {
                    ChatTurnStatus.completed: ExecutionEventType.turn_completed,
                    ChatTurnStatus.partially_completed: ExecutionEventType.turn_partially_completed,
                    ChatTurnStatus.failed: ExecutionEventType.turn_failed,
                }[outcome.status]
                await on_event(
                    ExecutionEvent(
                        event_type=event_type,
                        session_id=session_id,
                        turn_id=turn_id,
                        payload={
                            "follow_up": True,
                            "cycle_number": cycle_number,
                            "status": outcome.status.value,
                            "response_count": outcome.response_count,
                            "critique_count": outcome.critique_count,
                            "synthesis_count": outcome.synthesis_count,
                            "missing_stages": list(outcome.missing_stages),
                            "safe_error": (
                                outcome.safe_error.to_frontend_dict()
                                if outcome.safe_error is not None
                                else None
                            ),
                        },
                    )
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "[FollowUp] terminal reconciliation failed turn=%s cycle=%d",
                    turn_id,
                    cycle_number,
                )


__all__ = ["FollowupCycleOutcome", "reconcile_followup_status", "run_followup_cycle"]


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
