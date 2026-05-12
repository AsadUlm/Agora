"""
Round Manager — executes one debate round with controlled per-agent parallelism.

Key guarantees:
  - Independent AsyncSession per concurrent agent task
  - Configurable per-round concurrency cap (LLM_MAX_CONCURRENT_AGENT_CALLS)
  - Deterministic sequence numbers preassigned by stable agent order
  - Immediate message_created WS event after each task commit
  - Failure isolation: one failed agent does not block others
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.models.llm_call import LLMCall, LLMCallStatus
from app.models.message import Message, MessageType, MessageVisibility, SenderType
from app.models.round import Round, RoundStatus, RoundType
from app.schemas.contracts import (
    AgentContext,
    AgentRoundResult,
    ExecutionEvent,
    ExecutionEventType,
    LLMRequest,
    OnEventCallback,
    RetrievedChunk,
    TurnContext,
)
from app.services.debate_engine.prompts.round1_prompts import build_opening_statement_prompt
from app.services.debate_engine.prompts.round2_prompts import build_critique_prompt
from app.services.debate_engine.prompts.round3_prompts import build_final_synthesis_prompt
from app.services.debate_engine.prompts.followup_prompts import (
    build_followup_response_prompt,
    build_followup_critique_prompt,
    build_updated_synthesis_prompt,
)
from app.services.debate_engine.prompts.personas import resolve_temperature
from app.services.debate_engine.response_normalizer import normalize_round_output
from app.services.debate_engine.two_stage_structurer import recover_json_with_llm
from app.services.llm.exceptions import LLMError
from app.services.llm.service import LLMService, get_llm_service
from app.services.retrieval.retrieval_service import RetrievalService
from app.services.retrieval.evidence import (
    EvidencePacket,
    build_evidence_packets,
)
from app.services.retrieval.router import select_strategy

logger = logging.getLogger(__name__)

# ── LLM output budget ────────────────────────────────────────────────────────
MAX_ALLOWED_TOKENS = 2000
ROUND_MAX_TOKENS: dict[int, int] = {
    1: 650,
    2: 850,
    3: 900,
}
DEFAULT_MAX_TOKENS = 850
FOLLOWUP_MAX_TOKENS = 900
RETRIEVAL_TOP_K = 3

# Per-round-type token budgets (Step 25). Critique rounds get a tighter
# budget because the new contract is short and focused (assumption / why /
# implication). Synthesis rounds get more room because they must surface
# winning vs losing arguments and a confidence call.
ROUND_TYPE_MAX_TOKENS: dict[str, int] = {
    "initial": 650,
    "critique": 600,
    "final": 1100,
    "followup_response": 800,
    "followup_critique": 600,
    "updated_synthesis": 1000,
}


def _resolve_max_tokens(round_number: int, round_type: str | None = None) -> int:
    """Return the clamped max_tokens budget for a given round.

    ``round_type`` (when provided) takes precedence over ``round_number`` so
    follow-up critiques can use a tighter budget than follow-up responses.
    """
    if round_type:
        rt = (round_type or "").lower()
        if rt in ROUND_TYPE_MAX_TOKENS:
            return min(ROUND_TYPE_MAX_TOKENS[rt], MAX_ALLOWED_TOKENS)
    if round_number > 3:
        return min(FOLLOWUP_MAX_TOKENS, MAX_ALLOWED_TOKENS)
    budget = ROUND_MAX_TOKENS.get(round_number, DEFAULT_MAX_TOKENS)
    return min(budget, MAX_ALLOWED_TOKENS)


def _estimate_tokens_from_chars(char_count: int) -> int:
    """Quick token estimate for logging and perf diagnostics."""
    return max(1, int(char_count / 4))


@dataclass(frozen=True)
class _AgentTaskPlan:
    agent_ctx: AgentContext
    agent_index: int
    sequence_no: int
    message_type: MessageType
    prompt_builder: Any | None = None
    skipped_result: AgentRoundResult | None = None
    used_evidence_ids: tuple[str, ...] = ()
    # Step 31: hints used by the retrieval router. Defaults are safe — initial
    # rounds (cycle 1, no prior evidence memory) get the base role strategy.
    cycle_number: int = 1
    evidence_memory_view: dict[str, Any] | None = None


class RoundManager:
    """
    Executes one round (1, 2, or 3) within a debate turn.

    The sequence counter is monotonic across all rounds in one turn.
    Sequence values are assigned before task fan-out to keep ordering deterministic.
    """

    def __init__(
        self,
        db: AsyncSession,
        seq_start: int = 0,
        on_event: OnEventCallback | None = None,
        step_controller: Any = None,
        session_factory: Any = None,
        max_concurrent_agent_calls: int | None = None,
    ) -> None:
        self.db = db
        self._seq = seq_start
        self._retrieval = RetrievalService()
        self._llm: LLMService = get_llm_service()
        self._on_event = on_event
        self._step_controller = step_controller
        self._session_factory = session_factory or self._build_session_factory_from_db(db)

        configured_concurrency = (
            max_concurrent_agent_calls
            if max_concurrent_agent_calls is not None
            else settings.LLM_MAX_CONCURRENT_AGENT_CALLS
        )
        self._max_concurrent_agent_calls = max(1, int(configured_concurrency))

    @property
    def next_seq(self) -> int:
        """Return current sequence number and advance the counter."""
        val = self._seq
        self._seq += 1
        return val

    # ─────────────────────────────────────────────────────────────────────────
    # Public execution methods
    # ─────────────────────────────────────────────────────────────────────────

    async def execute_round_1(self, ctx: TurnContext) -> list[AgentRoundResult]:
        """Round 1 — Opening statements (parallel across agents)."""
        round_record = await self._create_round(
            ctx,
            round_number=1,
            round_type=RoundType.initial,
        )

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq

            def _build_prompt(chunks: list[RetrievedChunk], packets: list[EvidencePacket], agent: AgentContext = agent_ctx) -> str:
                return build_opening_statement_prompt(
                    role=agent.role,
                    question=ctx.question,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    evidence_packets=packets,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.agent_response,
                    prompt_builder=_build_prompt,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in Round 1."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)

        await self._complete_round(round_record, ctx)
        return results

    async def execute_round_2(
        self,
        ctx: TurnContext,
        round1_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Round 2 — Cross examination (parallel across agents)."""
        round_record = await self._create_round(
            ctx,
            round_number=2,
            round_type=RoundType.critique,
        )

        r1_by_id: dict[str, AgentRoundResult] = {str(r.agent_id): r for r in round1_results}
        plans: list[_AgentTaskPlan] = []

        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            own_stance = _first_non_empty(
                [
                    own_r1.structured.get("main_argument", "") if own_r1 else "",
                    own_r1.structured.get("short_summary", "") if own_r1 else "",
                    own_r1.structured.get("stance", "") if own_r1 else "",
                ]
            )

            other_agents: list[dict[str, Any]] = []
            for r in round1_results:
                if r.agent_id == agent_ctx.agent_id:
                    continue
                if r.generation_status != "success":
                    continue
                summary = _first_non_empty(
                    [
                        r.structured.get("main_argument", ""),
                        r.structured.get("short_summary", ""),
                        r.structured.get("stance", ""),
                    ]
                )
                key_points = r.structured.get("key_points", [])
                if not isinstance(key_points, list):
                    key_points = []
                other_agents.append(
                    {
                        "role": r.role,
                        "stance": summary,
                        "key_points": key_points,
                    }
                )

            if not other_agents:
                skipped_result = AgentRoundResult(
                    agent_id=agent_ctx.agent_id,
                    role=agent_ctx.role,
                    content=json.dumps(
                        {
                            "short_summary": "No valid opponent response was available, so this critique targets the general position.",
                            "target_agent": "General position",
                            "challenge": "The target response was unavailable, so this critique focuses on the general position.",
                            "weakness_found": "Without concrete target content, the main weakness is insufficient evidence and unclear assumptions.",
                            "counterargument": "A stronger position should provide explicit evidence, constraints, and implementation details.",
                            "response": "The target response was unavailable, so this critique focuses on the general position. A stronger argument should provide explicit evidence, clear assumptions, and practical implementation details.",
                        },
                        ensure_ascii=False,
                    ),
                    structured={
                        "short_summary": "No valid opponent response was available, so this critique targets the general position.",
                        "target_agent": "General position",
                        "challenge": "The target response was unavailable, so this critique focuses on the general position.",
                        "weakness_found": "Without concrete target content, the main weakness is insufficient evidence and unclear assumptions.",
                        "counterargument": "A stronger position should provide explicit evidence, constraints, and implementation details.",
                        "response": "The target response was unavailable, so this critique focuses on the general position. A stronger argument should provide explicit evidence, clear assumptions, and practical implementation details.",
                    },
                    generation_status="skipped",
                    error="No successful opponents to critique.",
                )
                plans.append(
                    _AgentTaskPlan(
                        agent_ctx=agent_ctx,
                        agent_index=agent_index,
                        sequence_no=sequence_no,
                        message_type=MessageType.critique,
                        skipped_result=skipped_result,
                    )
                )
                continue

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                own: str = own_stance,
                others: list[dict[str, Any]] = other_agents,
            ) -> str:
                return build_critique_prompt(
                    role=agent.role,
                    question=ctx.question,
                    own_stance=own,
                    other_agents=others,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    evidence_packets=packets,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.critique,
                    prompt_builder=_build_prompt,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in Round 2."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)

        await self._complete_round(round_record, ctx)
        return results

    async def execute_round_3(
        self,
        ctx: TurnContext,
        round1_results: list[AgentRoundResult],
        round2_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Round 3 — Final synthesis (parallel across agents)."""
        round_record = await self._create_round(
            ctx,
            round_number=3,
            round_type=RoundType.final,
        )

        r1_by_id: dict[str, AgentRoundResult] = {str(r.agent_id): r for r in round1_results}
        debate_digest = _build_round3_digest(
            question=ctx.question,
            round1_results=round1_results,
            round2_results=round2_results,
        )
        debate_digest_text = json.dumps(debate_digest, ensure_ascii=False)

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            original_stance = _first_non_empty(
                [
                    own_r1.structured.get("final_position", "") if own_r1 else "",
                    own_r1.structured.get("main_argument", "") if own_r1 else "",
                    own_r1.structured.get("short_summary", "") if own_r1 else "",
                    own_r1.structured.get("stance", "") if own_r1 else "",
                ]
            )

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                stance: str = original_stance,
                summary: str = debate_digest_text,
            ) -> str:
                return build_final_synthesis_prompt(
                    role=agent.role,
                    question=ctx.question,
                    original_stance=stance,
                    debate_digest=summary,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    evidence_packets=packets,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.final_summary,
                    prompt_builder=_build_prompt,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in Round 3."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)

        await self._complete_round(round_record, ctx)
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Public execution methods — follow-up cycles (cycle ≥ 2)
    # ─────────────────────────────────────────────────────────────────────────

    async def execute_followup_response(
        self,
        ctx: TurnContext,
        cycle_number: int,
        round_number: int,
        follow_up_question: str,
        memory: dict[str, Any],
    ) -> list[AgentRoundResult]:
        """Cycle 2+ Round A — every agent answers the new question."""
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.followup_response,
            cycle_number=cycle_number,
        )

        agent_states = {
            str(s.get("agent_id")): s for s in memory.get("agent_states", [])
        }
        previous_synthesis = memory.get("previous_synthesis", "") or ""
        original_question = memory.get("original_question", "") or ctx.question
        debate_summary = memory.get("debate_summary") or {}
        cycle_memories = memory.get("cycle_memories") or []
        evolving_positions = memory.get("evolving_positions") or []
        evidence_memory = memory.get("evidence_memory") or {}
        used_evidence_tuple = tuple(
            str(x) for x in (evidence_memory.get("cited_sources") or [])
        )

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            state = agent_states.get(str(agent_ctx.agent_id), {})
            previous_position = state.get("latest_position", "") or ""
            key_arguments = state.get("key_arguments", []) or []

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                prev_pos: str = previous_position,
                kargs: list[str] = key_arguments,
            ) -> str:
                return build_followup_response_prompt(
                    role=agent.role,
                    original_question=original_question,
                    follow_up_question=follow_up_question,
                    previous_synthesis=previous_synthesis,
                    own_previous_position=prev_pos,
                    own_key_arguments=kargs,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    debate_summary=debate_summary,
                    cycle_memories=cycle_memories,
                    evolving_positions=evolving_positions,
                    evidence_packets=packets,
                    evidence_memory=evidence_memory,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.agent_response,
                    prompt_builder=_build_prompt,
                    used_evidence_ids=used_evidence_tuple,
                    cycle_number=cycle_number,
                    evidence_memory_view=evidence_memory,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in follow-up response."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)
        await self._complete_round(round_record, ctx)
        return results

    async def start_followup_response_streaming(
        self,
        ctx: TurnContext,
        cycle_number: int,
        round_number: int,
        follow_up_question: str,
        memory: dict[str, Any],
        min_ready: int = 2,
    ) -> tuple[Round, "asyncio.Future[list[AgentRoundResult]]", "asyncio.Future[list[AgentRoundResult]]"]:
        """Streaming variant of follow-up response — returns as soon as ``min_ready``
        agents have produced a successful result. The remaining agent tasks
        continue running in the background; both futures are awaitable separately.

        Returns:
            (round_record, ready_future, all_done_future)
            - ``ready_future``: resolves with the partial results (≥ ``min_ready``
              successes, plus any task that finished early — failed or skipped) as
              soon as the threshold is reached.
            - ``all_done_future``: resolves with the complete list of results once
              every task finishes. The response Round is also marked ``completed``
              (or ``failed`` if all agents failed) at this point.

        Caller responsibility: always await ``all_done_future`` to ensure the
        Round status transitions correctly and exceptions are surfaced.
        """
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.followup_response,
            cycle_number=cycle_number,
        )

        agent_states = {
            str(s.get("agent_id")): s for s in memory.get("agent_states", [])
        }
        previous_synthesis = memory.get("previous_synthesis", "") or ""
        original_question = memory.get("original_question", "") or ctx.question
        debate_summary = memory.get("debate_summary") or {}
        cycle_memories = memory.get("cycle_memories") or []
        evolving_positions = memory.get("evolving_positions") or []

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            state = agent_states.get(str(agent_ctx.agent_id), {})
            previous_position = state.get("latest_position", "") or ""
            key_arguments = state.get("key_arguments", []) or []

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                prev_pos: str = previous_position,
                kargs: list[str] = key_arguments,
            ) -> str:
                return build_followup_response_prompt(
                    role=agent.role,
                    original_question=original_question,
                    follow_up_question=follow_up_question,
                    previous_synthesis=previous_synthesis,
                    own_previous_position=prev_pos,
                    own_key_arguments=kargs,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    debate_summary=debate_summary,
                    cycle_memories=cycle_memories,
                    evidence_packets=packets,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.agent_response,
                    prompt_builder=_build_prompt,
                )
            )

        loop = asyncio.get_running_loop()
        ready_future: asyncio.Future[list[AgentRoundResult]] = loop.create_future()
        all_done_future: asyncio.Future[list[AgentRoundResult]] = loop.create_future()
        threshold = max(1, min(min_ready, len(plans)))

        concurrency = self._resolve_round_concurrency(ctx.turn_id, len(plans))
        semaphore = asyncio.Semaphore(concurrency)
        results_so_far: list[AgentRoundResult] = []
        success_count = 0
        results_lock = asyncio.Lock()

        async def _run_plan(plan: _AgentTaskPlan) -> AgentRoundResult:
            async with semaphore:
                if plan.skipped_result is not None:
                    return await self._persist_skipped_result(ctx, round_record, plan)
                return await self._run_agent_task(ctx, round_record, plan)

        async def _track(plan: _AgentTaskPlan) -> AgentRoundResult:
            nonlocal success_count
            try:
                res = await _run_plan(plan)
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Streaming response task failed: round=%d agent=%s",
                    round_record.round_number,
                    plan.agent_ctx.agent_id,
                    exc_info=True,
                )
                res = await self._persist_unhandled_task_failure(
                    ctx=ctx, round_record=round_record, plan=plan, error=str(exc)
                )
            async with results_lock:
                results_so_far.append(res)
                if res.generation_status == "success":
                    success_count += 1
                if (
                    success_count >= threshold
                    and not ready_future.done()
                ):
                    ready_future.set_result(list(results_so_far))
            return res

        async def _orchestrate() -> None:
            tasks = [asyncio.create_task(_track(p)) for p in plans]
            try:
                gathered = await asyncio.gather(*tasks, return_exceptions=False)
            except Exception as exc:
                if not all_done_future.done():
                    all_done_future.set_exception(exc)
                if not ready_future.done():
                    ready_future.set_exception(exc)
                return
            # Ensure ready_future fires even if the threshold was never reached
            # (e.g. all agents failed) — the runner will see the failures and
            # decide whether to abort.
            if not ready_future.done():
                ready_future.set_result(list(gathered))
            if self._all_agents_failed(gathered):
                reason = "All agents failed in follow-up response."
                try:
                    await self._fail_round(round_record, reason)
                finally:
                    if not all_done_future.done():
                        all_done_future.set_exception(RuntimeError(reason))
                return
            try:
                await self._complete_round(round_record, ctx)
            finally:
                if not all_done_future.done():
                    all_done_future.set_result(gathered)

        asyncio.create_task(_orchestrate())
        return round_record, ready_future, all_done_future

    async def execute_followup_critique(
        self,
        ctx: TurnContext,
        cycle_number: int,
        round_number: int,
        follow_up_question: str,
        memory: dict[str, Any],
        followup_responses: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Cycle 2+ Round B — agents challenge the weakest peer follow-up answer."""
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.followup_critique,
            cycle_number=cycle_number,
        )

        original_question = memory.get("original_question", "") or ctx.question
        previous_synthesis = memory.get("previous_synthesis", "") or ""
        responses_by_id = {str(r.agent_id): r for r in followup_responses}
        debate_summary = memory.get("debate_summary") or {}
        cycle_memories = memory.get("cycle_memories") or []
        evolving_positions = memory.get("evolving_positions") or []
        evidence_memory = memory.get("evidence_memory") or {}
        used_evidence_tuple = tuple(
            str(x) for x in (evidence_memory.get("cited_sources") or [])
        )

        # When no peer answers are available, the critique prompt itself must
        # still produce a useful challenge by targeting the strongest argument
        # or an unresolved question. We surface those via debate_summary so the
        # prompt's selection rules (peer → strongest_argument → unresolved) can
        # apply uniformly. We never "skip" anymore.

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            own = responses_by_id.get(str(agent_ctx.agent_id))
            own_answer = ""
            if own is not None:
                own_answer = _first_non_empty(
                    [
                        own.structured.get("answer_to_followup", ""),
                        own.structured.get("response", ""),
                        own.structured.get("display_content", ""),
                    ]
                )

            other: list[dict[str, Any]] = []
            for r in followup_responses:
                if r.agent_id == agent_ctx.agent_id or r.generation_status != "success":
                    continue
                ans = _first_non_empty(
                    [
                        r.structured.get("answer_to_followup", ""),
                        r.structured.get("response", ""),
                        r.structured.get("display_content", ""),
                    ]
                )
                if ans:
                    other.append({"role": r.role, "answer": ans})

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                own_text: str = own_answer,
                others_list: list[dict[str, Any]] = other,
            ) -> str:
                return build_followup_critique_prompt(
                    role=agent.role,
                    original_question=original_question,
                    follow_up_question=follow_up_question,
                    previous_synthesis=previous_synthesis,
                    own_followup=own_text,
                    other_followups=others_list,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    debate_summary=debate_summary,
                    cycle_memories=cycle_memories,
                    evolving_positions=evolving_positions,
                    evidence_packets=packets,
                    evidence_memory=evidence_memory,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.critique,
                    prompt_builder=_build_prompt,
                    used_evidence_ids=used_evidence_tuple,
                    cycle_number=cycle_number,
                    evidence_memory_view=evidence_memory,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in follow-up critique."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)
        await self._complete_round(round_record, ctx)
        return results

    async def execute_updated_synthesis(
        self,
        ctx: TurnContext,
        cycle_number: int,
        round_number: int,
        follow_up_question: str,
        memory: dict[str, Any],
        followup_responses: list[AgentRoundResult],
        followup_critiques: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Cycle 2+ Round C — updated synthesis reflecting the new debate state."""
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.updated_synthesis,
            cycle_number=cycle_number,
        )

        original_question = memory.get("original_question", "") or ctx.question
        previous_synthesis = memory.get("previous_synthesis", "") or ""
        debate_summary = memory.get("debate_summary") or {}
        cycle_memories = memory.get("cycle_memories") or []
        evolving_positions = memory.get("evolving_positions") or []
        evidence_memory = memory.get("evidence_memory") or {}
        used_evidence_tuple = tuple(
            str(x) for x in (evidence_memory.get("cited_sources") or [])
        )

        responses_block = [
            {
                "role": r.role,
                "answer": _first_non_empty(
                    [
                        r.structured.get("answer_to_followup", ""),
                        r.structured.get("response", ""),
                        r.structured.get("display_content", ""),
                    ]
                ),
            }
            for r in followup_responses
            if r.generation_status == "success"
        ]
        critiques_block = [
            {
                "role": c.role,
                "target": c.structured.get("target_agent", ""),
                "challenge": _first_non_empty(
                    [
                        c.structured.get("challenge", ""),
                        c.structured.get("counterargument", ""),
                    ]
                ),
            }
            for c in followup_critiques
            if c.generation_status == "success"
        ]

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                resp: list[dict[str, Any]] = responses_block,
                crit: list[dict[str, Any]] = critiques_block,
            ) -> str:
                return build_updated_synthesis_prompt(
                    role=agent.role,
                    original_question=original_question,
                    follow_up_question=follow_up_question,
                    previous_synthesis=previous_synthesis,
                    followup_responses=resp,
                    followup_critiques=crit,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
                    retrieved_chunks=[c.model_dump() for c in chunks],
                    knowledge_mode=agent.knowledge_mode,
                    knowledge_strict=agent.knowledge_strict,
                    debate_summary=debate_summary,
                    cycle_memories=cycle_memories,
                    evolving_positions=evolving_positions,
                    evidence_packets=packets,
                    evidence_memory=evidence_memory,
                )

            plans.append(
                _AgentTaskPlan(
                    agent_ctx=agent_ctx,
                    agent_index=agent_index,
                    sequence_no=sequence_no,
                    message_type=MessageType.final_summary,
                    prompt_builder=_build_prompt,
                    used_evidence_ids=used_evidence_tuple,
                    cycle_number=cycle_number,
                    evidence_memory_view=evidence_memory,
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in updated synthesis."
            await self._fail_round(round_record, reason)
            raise RuntimeError(reason)
        await self._complete_round(round_record, ctx)
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — parallel execution
    # ─────────────────────────────────────────────────────────────────────────

    def _resolve_round_concurrency(self, turn_id: uuid.UUID, agent_count: int) -> int:
        base = min(agent_count, self._max_concurrent_agent_calls)
        if self._step_controller is None:
            return max(1, base)

        snapshot_fn = getattr(self._step_controller, "snapshot", None)
        if callable(snapshot_fn):
            snap = snapshot_fn(turn_id)
            if isinstance(snap, dict) and snap.get("mode") == "manual":
                logger.info(
                    "Manual mode detected for turn=%s; forcing round concurrency to 1",
                    turn_id,
                )
                return 1
        return max(1, base)

    async def _execute_round_parallel(
        self,
        ctx: TurnContext,
        round_record: Round,
        plans: list[_AgentTaskPlan],
    ) -> list[AgentRoundResult]:
        if not plans:
            return []

        concurrency = self._resolve_round_concurrency(ctx.turn_id, len(plans))
        logger.info(
            "Round %d parallel start agents=%d concurrency=%d",
            round_record.round_number,
            len(plans),
            concurrency,
        )

        started_perf = time.perf_counter()
        semaphore = asyncio.Semaphore(concurrency)

        async def _run_plan(plan: _AgentTaskPlan) -> AgentRoundResult:
            async with semaphore:
                if plan.skipped_result is not None:
                    return await self._persist_skipped_result(ctx, round_record, plan)
                if plan.prompt_builder is None:
                    raise RuntimeError("Agent task plan has no prompt builder.")
                return await self._run_agent_task(ctx, round_record, plan)

        gathered = await asyncio.gather(
            *[_run_plan(plan) for plan in plans],
            return_exceptions=True,
        )

        results: list[AgentRoundResult] = []
        for plan, item in zip(plans, gathered, strict=False):
            if isinstance(item, Exception):
                logger.error(
                    "Unhandled agent task exception: round=%d agent=%s role=%s",
                    round_record.round_number,
                    plan.agent_ctx.agent_id,
                    plan.agent_ctx.role,
                    exc_info=(type(item), item, item.__traceback__),
                )
                fallback = await self._persist_unhandled_task_failure(
                    ctx=ctx,
                    round_record=round_record,
                    plan=plan,
                    error=str(item),
                )
                results.append(fallback)
            else:
                results.append(item)

        elapsed_s = time.perf_counter() - started_perf
        failed_count = sum(1 for r in results if r.generation_status == "failed")
        logger.info(
            "Round %d parallel done in %.2fs failed=%d/%d",
            round_record.round_number,
            elapsed_s,
            failed_count,
            len(results),
        )
        return results

    async def _run_agent_task(
        self,
        ctx: TurnContext,
        round_record: Round,
        plan: _AgentTaskPlan,
    ) -> AgentRoundResult:
        agent_started_perf = time.perf_counter()

        async with self._session_factory() as task_db:
            chunks = await self._retrieve_for_agent(
                task_db,
                ctx,
                plan.agent_ctx,
                cycle_number=plan.cycle_number,
                evidence_memory_view=plan.evidence_memory_view,
            )
            # Step 29: build structured evidence packets so the prompt can
            # cite by [E1]/[E2] labels and reason about source reliability.
            try:
                packets = await build_evidence_packets(
                    task_db,
                    chunks,
                    used_evidence_ids=plan.used_evidence_ids or None,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Evidence packet build failed (round=%d agent=%s): %s — "
                    "falling back to raw chunks",
                    round_record.round_number,
                    plan.agent_ctx.agent_id,
                    exc,
                )
                packets = []
            try:
                prompt = plan.prompt_builder(chunks, packets)
            except TypeError:
                # Backward compatibility: legacy single-arg builders.
                prompt = plan.prompt_builder(chunks)
            result = await self._call_llm(
                db=task_db,
                agent_ctx=plan.agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=plan.message_type,
                sequence_no=plan.sequence_no,
                agent_index=plan.agent_index,
                retrieved_chunks=chunks,
            )

        elapsed_s = time.perf_counter() - agent_started_perf
        logger.info(
            "Agent %s done in %.2fs status=%s round=%d",
            plan.agent_ctx.role,
            elapsed_s,
            result.generation_status,
            round_record.round_number,
        )
        return result

    async def _persist_skipped_result(
        self,
        ctx: TurnContext,
        round_record: Round,
        plan: _AgentTaskPlan,
    ) -> AgentRoundResult:
        skipped = plan.skipped_result
        if skipped is None:
            raise RuntimeError("Skipped task must provide skipped_result.")

        message_id: str | None = None
        async with self._session_factory() as task_db:
            msg = await self._save_message(
                db=task_db,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                round_id=round_record.id,
                agent_id=plan.agent_ctx.agent_id,
                sender_type=SenderType.agent,
                message_type=plan.message_type,
                content=skipped.content,
                sequence_no=plan.sequence_no,
            )
            await task_db.commit()
            message_id = str(msg.id)

        if self._on_event is not None:
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.message_created,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                    agent_id=plan.agent_ctx.agent_id,
                    payload={
                        "message_id": message_id,
                        "round_id": str(round_record.id),
                        "sender_type": SenderType.agent.value,
                        "message_type": plan.message_type.value,
                        "content": skipped.content,
                        "sequence_no": plan.sequence_no,
                        "generation_status": skipped.generation_status,
                        "agent_role": plan.agent_ctx.role,
                        "agent_index": plan.agent_index,
                    },
                )
            )
        return skipped

    async def _persist_unhandled_task_failure(
        self,
        ctx: TurnContext,
        round_record: Round,
        plan: _AgentTaskPlan,
        error: str,
    ) -> AgentRoundResult:
        content = json.dumps({"error": error})
        message_id: str | None = None

        try:
            async with self._session_factory() as task_db:
                msg = await self._save_message(
                    db=task_db,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    agent_id=plan.agent_ctx.agent_id,
                    sender_type=SenderType.agent,
                    message_type=plan.message_type,
                    content=content,
                    sequence_no=plan.sequence_no,
                )
                await task_db.commit()
                message_id = str(msg.id)
        except Exception:
            logger.exception(
                "Failed to persist fallback error message: round=%d agent=%s",
                round_record.round_number,
                plan.agent_ctx.agent_id,
            )

        if self._on_event is not None:
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.message_created,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                    agent_id=plan.agent_ctx.agent_id,
                    payload={
                        "message_id": message_id,
                        "round_id": str(round_record.id),
                        "sender_type": SenderType.agent.value,
                        "message_type": plan.message_type.value,
                        "content": content,
                        "sequence_no": plan.sequence_no,
                        "generation_status": "failed",
                        "agent_role": plan.agent_ctx.role,
                        "agent_index": plan.agent_index,
                    },
                )
            )

        return AgentRoundResult(
            agent_id=plan.agent_ctx.agent_id,
            role=plan.agent_ctx.role,
            content=content,
            structured={},
            generation_status="failed",
            error=error,
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — DB operations
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_session_factory_from_db(db: AsyncSession) -> Any:
        bind = db.get_bind()
        if bind is None:
            raise RuntimeError("Unable to resolve DB bind for RoundManager session factory.")
        return async_sessionmaker(
            bind=bind,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )

    async def _create_round(
        self,
        ctx: TurnContext,
        round_number: int,
        round_type: RoundType,
        cycle_number: int = 1,
    ) -> Round:
        """Create a Round record, mark it running, and persist before fan-out."""
        round_record = Round(
            chat_turn_id=ctx.turn_id,
            round_number=round_number,
            cycle_number=cycle_number,
            round_type=round_type,
            status=RoundStatus.queued,
        )
        self.db.add(round_record)
        await self.db.flush()

        round_record.status = RoundStatus.running
        round_record.started_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.commit()

        logger.info(
            "Round %d running (id=%s, turn=%s)",
            round_number,
            round_record.id,
            ctx.turn_id,
        )
        if self._on_event is not None:
            logger.info(
                "WS emit round_started round=%d turn=%s",
                round_number,
                ctx.turn_id,
            )
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.round_started,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_number=round_number,
                )
            )

        return round_record

    async def _complete_round(self, round_record: Round, ctx: TurnContext) -> None:
        """Transition round: running → completed and emit round_completed."""
        round_record.status = RoundStatus.completed
        round_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.commit()

        logger.info("Round %d completed.", round_record.round_number)
        if self._on_event is not None:
            logger.info(
                "WS emit round_completed round=%d turn=%s",
                round_record.round_number,
                ctx.turn_id,
            )
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.round_completed,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                )
            )

    async def _fail_round(self, round_record: Round, reason: str) -> None:
        """Transition round: running → failed."""
        round_record.status = RoundStatus.failed
        round_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()
        await self.db.commit()
        logger.error("Round %d failed: %s", round_record.round_number, reason)

    async def _raw_llm_call(self, request: LLMRequest) -> str:
        """Lightweight LLM call wrapper used by the two-stage structurer.

        Returns the raw text content. The caller is responsible for parsing.
        """
        response = await self._llm.generate(request)
        return response.content or ""

    async def _save_message(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        turn_id: uuid.UUID,
        round_id: uuid.UUID,
        agent_id: uuid.UUID | None,
        sender_type: SenderType,
        message_type: MessageType,
        content: str,
        sequence_no: int,
        visibility: MessageVisibility = MessageVisibility.visible,
    ) -> Message:
        msg = Message(
            chat_session_id=session_id,
            chat_turn_id=turn_id,
            round_id=round_id,
            chat_agent_id=agent_id,
            sender_type=sender_type,
            message_type=message_type,
            visibility=visibility,
            content=content,
            sequence_no=sequence_no,
        )
        db.add(msg)
        await db.flush()
        return msg

    async def _save_llm_call(
        self,
        db: AsyncSession,
        turn_id: uuid.UUID,
        round_id: uuid.UUID,
        agent_id: uuid.UUID,
        provider: str,
        model: str,
        temperature: float,
        status: LLMCallStatus,
        started_at: datetime,
        ended_at: datetime,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
    ) -> LLMCall:
        call_record = LLMCall(
            chat_turn_id=turn_id,
            round_id=round_id,
            chat_agent_id=agent_id,
            provider=provider,
            model=model,
            temperature=temperature,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            status=status,
            started_at=started_at,
            ended_at=ended_at,
        )
        db.add(call_record)
        await db.flush()
        return call_record

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — retrieval and LLM orchestration
    # ─────────────────────────────────────────────────────────────────────────

    async def _retrieve_for_agent(
        self,
        db: AsyncSession,
        ctx: TurnContext,
        agent_ctx: AgentContext,
        *,
        cycle_number: int = 1,
        evidence_memory_view: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        # Step 31: pick a role-aware retrieval strategy. ``select_strategy`` is
        # pure / deterministic and free for any role string — unknown roles
        # fall back to a balanced default strategy.
        strategy = select_strategy(
            agent_ctx.role,
            cycle_number=cycle_number,
            evidence_memory=evidence_memory_view,
        )
        return await self._retrieval.retrieve_for_agent(
            agent_id=agent_ctx.agent_id,
            session_id=ctx.session_id,
            query=ctx.question,
            db=db,
            knowledge_mode=agent_ctx.knowledge_mode,
            assigned_document_ids=agent_ctx.assigned_document_ids,
            top_k=RETRIEVAL_TOP_K,
            strategy=strategy,
        )

    async def _build_retrieval_summary(
        self,
        db: AsyncSession,
        chunks: list[RetrievedChunk],
        max_chunks: int = RETRIEVAL_TOP_K,
        text_chars: int = 280,
    ) -> dict[str, Any] | None:
        if not chunks:
            return None

        from app.models.document import Document

        capped = chunks[:max_chunks]
        doc_ids = list({c.document_id for c in capped})
        names: dict[uuid.UUID, str] = {}
        try:
            rows = (
                await db.execute(
                    select(Document.id, Document.filename).where(Document.id.in_(doc_ids))
                )
            ).all()
            names = {row[0]: row[1] for row in rows}
        except Exception:
            logger.warning(
                "retrieval summary: failed to resolve document filenames",
                exc_info=True,
            )

        grouped: dict[uuid.UUID, list[dict[str, Any]]] = {}
        order: list[uuid.UUID] = []
        for c in capped:
            text = (c.content or "").strip().replace("\n", " ")
            if len(text) > text_chars:
                text = text[: text_chars - 1].rstrip() + "…"
            if c.document_id not in grouped:
                grouped[c.document_id] = []
                order.append(c.document_id)
            grouped[c.document_id].append(
                {"text": text, "score": round(float(c.similarity_score), 3)}
            )

        documents = [
            {
                "document_id": str(doc_id),
                "document_name": names.get(doc_id, "Untitled document"),
                "chunks": grouped[doc_id],
            }
            for doc_id in order
        ]
        return {"documents": documents, "total_chunks": len(capped)}

    async def _call_llm(
        self,
        db: AsyncSession,
        agent_ctx: AgentContext,
        prompt: str,
        round_record: Round,
        turn_id: uuid.UUID,
        session_id: uuid.UUID,
        message_type: MessageType,
        sequence_no: int,
        agent_index: int,
        retrieved_chunks: list[RetrievedChunk] | None = None,
    ) -> AgentRoundResult:
        step_meta = {
            "round_number": round_record.round_number,
            "agent_id": str(agent_ctx.agent_id),
            "agent_role": agent_ctx.role,
            "agent_index": agent_index,
            "message_type": message_type.value,
        }
        logger.info(
            "WS emit agent_started: turn=%s round=%d agent=%s role=%s type=%s idx=%d",
            turn_id,
            round_record.round_number,
            agent_ctx.agent_id,
            agent_ctx.role,
            message_type.value,
            agent_index,
        )
        if self._on_event is not None:
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.agent_started,
                    session_id=session_id,
                    turn_id=turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                    agent_id=agent_ctx.agent_id,
                    payload=step_meta,
                )
            )
        if self._step_controller is not None:
            await self._step_controller.wait_for_step(turn_id, step_meta)

        request = LLMRequest(
            provider=agent_ctx.provider,
            model=agent_ctx.model,
            prompt=prompt,
            temperature=resolve_temperature(
                role=agent_ctx.role,
                round_type=(
                    round_record.round_type.value
                    if round_record.round_type is not None
                    else None
                ),
                user_override=agent_ctx.temperature,
            ),
            max_tokens=_resolve_max_tokens(
                round_record.round_number,
                round_type=(
                    round_record.round_type.value
                    if round_record.round_type is not None
                    else None
                ),
            ),
        )

        retrieval_count = len(retrieved_chunks or [])
        prompt_chars = len(prompt)
        estimated_prompt_tokens = _estimate_tokens_from_chars(prompt_chars)
        llm_started_at = datetime.now(timezone.utc)
        llm_started_perf = time.perf_counter()

        logger.info(
            "LLM start: turn=%s round=%d agent=%s role=%s provider=%s model=%s prompt_chars=%d est_prompt_tokens=%d max_tokens=%d retrieval_chunks=%d started_at=%s",
            turn_id,
            round_record.round_number,
            agent_ctx.agent_id,
            agent_ctx.role,
            agent_ctx.provider,
            agent_ctx.model,
            prompt_chars,
            estimated_prompt_tokens,
            request.max_tokens or 0,
            retrieval_count,
            llm_started_at.isoformat(),
        )

        content = ""
        structured: dict[str, Any] = {}
        generation_status = "success"
        error_msg: str | None = None
        prompt_tokens = 0
        completion_tokens = 0
        provider_latency_ms = 0

        try:
            response = await self._llm.generate(request)
            raw_content = response.content
            prompt_tokens = response.prompt_tokens
            completion_tokens = response.completion_tokens
            provider_latency_ms = response.latency_ms

            if not raw_content or not raw_content.strip():
                raise LLMError(
                    "Model returned an empty response. "
                    "Check model compatibility with current request parameters "
                    "(max_tokens, response_format)."
                )

            normalized = normalize_round_output(
                round_number=round_record.round_number,
                raw_text=raw_content,
                round_type=round_record.round_type.value if round_record.round_type is not None else None,
            )

            # Stage 2 recovery: if the primary call produced unparseable JSON,
            # ask the model to convert its own RAW text into strict JSON before
            # accepting the cheap regex fallback. This costs at most one extra
            # short LLM call per failed agent (never per success).
            if normalized.payload.get("is_fallback") is True:
                round_type_value = (
                    round_record.round_type.value
                    if round_record.round_type is not None
                    else None
                )
                try:
                    recovered_payload = await recover_json_with_llm(
                        raw_content,
                        round_number=round_record.round_number,
                        round_type=round_type_value,
                        llm_call=self._raw_llm_call,
                        provider=agent_ctx.provider,
                        model=agent_ctx.model,
                        temperature=0.0,
                        max_tokens=700,
                    )
                except Exception as recovery_exc:  # noqa: BLE001
                    logger.warning(
                        "Two-stage recovery raised: %s — keeping regex fallback.",
                        recovery_exc,
                    )
                    recovered_payload = None

                if recovered_payload is not None:
                    try:
                        recovered_normalized = normalize_round_output(
                            round_number=round_record.round_number,
                            raw_text=raw_content,
                            parsed_payload=recovered_payload,
                            round_type=round_type_value,
                        )
                    except Exception as renorm_exc:  # noqa: BLE001
                        logger.warning(
                            "Two-stage recovery normalization raised: %s — keeping regex fallback.",
                            renorm_exc,
                        )
                    else:
                        if recovered_normalized.payload.get("is_fallback") is False:
                            logger.info(
                                "Two-stage recovery succeeded for agent %s round %d.",
                                agent_ctx.agent_id,
                                round_record.round_number,
                            )
                            normalized = recovered_normalized

            structured = normalized.payload
            content = json.dumps(normalized.payload, ensure_ascii=False)

        except LLMError as exc:
            error_msg = str(exc)
            content = json.dumps({"error": error_msg})
            generation_status = "failed"
            logger.exception(
                "LLM failure for agent %s (%s) in round %d: %s",
                agent_ctx.agent_id,
                agent_ctx.role,
                round_record.round_number,
                exc,
            )
        except Exception as exc:
            error_msg = f"Unhandled provider error: {exc}"
            content = json.dumps({"error": error_msg})
            generation_status = "failed"
            logger.exception(
                "Unexpected LLM error for agent %s (%s) in round %d",
                agent_ctx.agent_id,
                agent_ctx.role,
                round_record.round_number,
            )

        llm_finished_at = datetime.now(timezone.utc)
        measured_duration_ms = int((time.perf_counter() - llm_started_perf) * 1000)
        effective_latency_ms = provider_latency_ms if provider_latency_ms > 0 else measured_duration_ms

        logger.info(
            "LLM done: turn=%s round=%d agent=%s status=%s duration_ms=%d provider_latency_ms=%d output_chars=%d prompt_tokens=%d completion_tokens=%d finished_at=%s",
            turn_id,
            round_record.round_number,
            agent_ctx.agent_id,
            generation_status,
            measured_duration_ms,
            provider_latency_ms,
            len(content or ""),
            prompt_tokens,
            completion_tokens,
            llm_finished_at.isoformat(),
        )

        await self._save_llm_call(
            db=db,
            turn_id=turn_id,
            round_id=round_record.id,
            agent_id=agent_ctx.agent_id,
            provider=agent_ctx.provider,
            model=agent_ctx.model,
            temperature=agent_ctx.temperature,
            status=(LLMCallStatus.completed if generation_status == "success" else LLMCallStatus.failed),
            started_at=llm_started_at,
            ended_at=llm_finished_at,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=effective_latency_ms,
        )

        msg = await self._save_message(
            db=db,
            session_id=session_id,
            turn_id=turn_id,
            round_id=round_record.id,
            agent_id=agent_ctx.agent_id,
            sender_type=SenderType.agent,
            message_type=message_type,
            content=content,
            sequence_no=sequence_no,
        )

        retrieval_summary: dict[str, Any] | None = None
        if retrieved_chunks:
            retrieval_summary = await self._build_retrieval_summary(db, retrieved_chunks)

        await db.commit()

        if self._on_event is not None:
            event_payload: dict[str, Any] = {
                "message_id": str(msg.id),
                "round_id": str(round_record.id),
                "sender_type": msg.sender_type.value,
                "message_type": msg.message_type.value,
                "content": msg.content,
                "sequence_no": sequence_no,
                "generation_status": generation_status,
                "agent_role": agent_ctx.role,
                "agent_index": agent_index,
            }
            if generation_status == "success" and isinstance(structured, dict):
                display_content = structured.get("display_content")
                short_summary = structured.get("short_summary")
                is_fallback = structured.get("is_fallback")
                if isinstance(display_content, str) and display_content.strip():
                    event_payload["display_content"] = display_content
                if isinstance(short_summary, str) and short_summary.strip():
                    event_payload["short_summary"] = short_summary
                if isinstance(is_fallback, bool):
                    event_payload["is_fallback"] = is_fallback
            if retrieval_summary is not None:
                event_payload["retrieval"] = retrieval_summary

            logger.info(
                "WS emit message_created: turn=%s round=%d agent=%s status=%s content_len=%d",
                turn_id,
                round_record.round_number,
                agent_ctx.agent_id,
                generation_status,
                len(content or ""),
            )
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.message_created,
                    session_id=session_id,
                    turn_id=turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                    agent_id=agent_ctx.agent_id,
                    payload=event_payload,
                )
            )

        return AgentRoundResult(
            agent_id=agent_ctx.agent_id,
            role=agent_ctx.role,
            content=content,
            structured=structured,
            generation_status=generation_status,
            error=error_msg,
        )

    @staticmethod
    def _all_agents_failed(results: list[AgentRoundResult]) -> bool:
        return bool(results) and all(r.generation_status == "failed" for r in results)


# ─────────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────────

def _build_debate_summary(round2_results: list[AgentRoundResult]) -> str:
    """Backwards-compatible helper used by older callers/tests."""
    digest = _build_round3_digest(
        question="",
        round1_results=[],
        round2_results=round2_results,
    )
    return json.dumps(digest, ensure_ascii=False)


def _build_round3_digest(
    question: str,
    round1_results: list[AgentRoundResult],
    round2_results: list[AgentRoundResult],
) -> dict[str, Any]:
    """Build compact structured digest for Round 3 prompt input."""
    round1_items: list[dict[str, Any]] = []
    for r1 in round1_results:
        if r1.generation_status != "success":
            continue
        key_points = r1.structured.get("key_points", [])
        if not isinstance(key_points, list):
            key_points = []
        key_points = [
            _clip_text(point, 160)
            for point in key_points
            if str(point or "").strip()
        ][:3]

        round1_items.append(
            {
                "agent": r1.role,
                "stance": _clip_text(
                    _first_non_empty(
                        [
                            r1.structured.get("stance", ""),
                            r1.structured.get("final_position", ""),
                            r1.structured.get("main_argument", ""),
                        ]
                    ),
                    160,
                ),
                "short_summary": _clip_text(
                    _first_non_empty(
                        [
                            r1.structured.get("short_summary", ""),
                            r1.structured.get("main_argument", ""),
                            r1.structured.get("response", ""),
                        ]
                    ),
                    220,
                ),
                "key_points": key_points,
            }
        )

    round2_items: list[dict[str, Any]] = []
    for r2 in round2_results:
        if r2.generation_status not in ("success", "skipped"):
            continue

        round2_items.append(
            {
                "agent": r2.role,
                "target_agent": _clip_text(
                    _first_non_empty(
                        [
                            r2.structured.get("target_agent", ""),
                            r2.structured.get("target_role", ""),
                        ]
                    )
                    or "General position",
                    120,
                ),
                "short_summary": _clip_text(
                    _first_non_empty(
                        [
                            r2.structured.get("short_summary", ""),
                            r2.structured.get("challenge", ""),
                            r2.structured.get("response", ""),
                        ]
                    ),
                    220,
                ),
                "challenge": _clip_text(
                    _first_non_empty(
                        [
                            r2.structured.get("challenge", ""),
                            r2.structured.get("response", ""),
                        ]
                    ),
                    220,
                ),
                "counterargument": _clip_text(
                    _first_non_empty(
                        [
                            r2.structured.get("counterargument", ""),
                            r2.structured.get("counter_evidence", ""),
                        ]
                    ),
                    220,
                ),
            }
        )

    return {
        "question": _clip_text(question, 400),
        "round1": round1_items,
        "round2": round2_items,
    }


def _build_round3_summary(
    round1_results: list[AgentRoundResult],
    round2_results: list[AgentRoundResult],
) -> str:
    """Backwards-compatible textual wrapper around the structured digest."""
    digest = _build_round3_digest(
        question="",
        round1_results=round1_results,
        round2_results=round2_results,
    )
    return json.dumps(digest, ensure_ascii=False)


def _first_non_empty(values: list[Any]) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _clip_text(value: Any, max_chars: int) -> str:
    text = str(value or "").replace("\n", " ").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"
