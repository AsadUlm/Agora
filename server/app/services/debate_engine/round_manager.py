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
from app.services.debate_engine.prompts.round_critique_response_prompts import build_critique_response_prompt
from app.services.debate_engine.prompts.round_revised_position_prompts import build_revised_position_prompt
from app.services.debate_engine.lifecycle import FinalSynthesisFailed, RequiredStageFailed
from app.services.debate_engine.prompts.synthesis_verdict_prompts import (
    build_synthesis_verdict_prompt,
)
from app.services.debate_engine.prompts.followup_prompts import (
    build_followup_response_prompt,
    build_followup_critique_prompt,
    build_updated_synthesis_prompt,
)
from app.services.debate_engine.prompts.personas import resolve_temperature
from app.services.debate_engine.response_normalizer import normalize_round_output
from app.services.debate_engine.quality_guards import (
    evaluate_round_quality,
    validate_structured_output,
)
from app.services.debate_engine.two_stage_structurer import (
    recover_json_with_llm,
    repair_structured_output_with_moderator,
)
from app.services.llm.exceptions import LLMError
from app.services.llm.service import LLMService, get_llm_service
from app.services.llm.provider_error_classifier import (
    classify_provider_error,
    make_safe_error,
    MODEL_EMPTY_RESPONSE,
    MODEL_INVALID_JSON,
    ROUND_ALL_AGENTS_FAILED,
    STRUCTURED_VALIDATION_FAILED,
    UNKNOWN_ERROR,
    DebateSafeError,
)
from app.services.retrieval.retrieval_service import RetrievalService
from app.services.retrieval.evidence import (
    EvidencePacket,
    build_evidence_packets,
)
from app.services.retrieval.router import select_strategy

logger = logging.getLogger(__name__)

# ── LLM output budget ────────────────────────────────────────────────────────
# Step 33: token budgets were previously too tight (R1=650, R2=850, etc.),
# which forced agents to compress analytical answers into slogans. The new
# budgets target full structured responses while staying within typical
# provider limits.
MAX_ALLOWED_TOKENS = 4000
ROUND_MAX_TOKENS: dict[int, int] = {
    1: 1800,
    2: 1800,
    3: 2000,
}
DEFAULT_MAX_TOKENS = 1500
FOLLOWUP_MAX_TOKENS = 1800
RETRIEVAL_TOP_K = 3

# Per-round-type token budgets. Critique/synthesis rounds were tightened in
# Step 25, but observation showed that this was the dominant cause of
# truncated analytical responses in Step 33. Budgets are now sized to fit a
# full multi-section answer (position, reasoning, peer response, risks,
# final stance) without clipping mid-word.
ROUND_TYPE_MAX_TOKENS: dict[str, int] = {
    "initial": 2000,
    "critique": 2200,
    "critique_response": 2000,
    "revised_position": 2200,
    "final": 2500,
    "followup_response": 2000,
    "followup_critique": 1800,
    "updated_synthesis": 2500,
    "synthesis_verdict": 2000,
}


# Phase 2: appended to the prompt on a single corrective regeneration when the
# first answer leaked prompt / schema / role / formatting text into content.
_LEAK_CORRECTION_SUFFIX = (
    "\n\nIMPORTANT CORRECTION: Your previous answer leaked instruction, schema, "
    "role, or formatting text into the user-facing content. Answer again as an "
    "expert panelist debating the question directly for a human reader. Do NOT "
    "mention JSON, schemas, field names, your role/persona, the instructions, "
    "or your own process. Produce only the required JSON where every field "
    "value is substantive debate content."
)

_STRUCTURED_CORRECTION_SUFFIX = (
    "\n\nIMPORTANT CORRECTION: Your previous answer was malformed or incomplete. "
    "Return a SINGLE valid JSON object only — no markdown, no code fences, no "
    "commentary before or after. Every required field must be present and filled "
    "with substantive debate content. Do NOT copy field descriptions, schema "
    "hints, placeholders, word counts, or example scaffolding into the values. "
    "The 'response' field must contain the full readable answer."
)


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
    # FIX-09: optional dict merged into the normalized structured payload
    # before the message is saved. Used to persist `followup_question` and
    # `followup_cycle` on every follow-up round message so downstream consumers
    # (UI, analytics) can identify which follow-up cycle a message belongs to.
    extra_payload_fields: dict[str, Any] | None = None


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
        # Serializes round-level bookkeeping writes (create/complete/fail) on the
        # shared ``self.db`` session. During the follow-up streaming overlap the
        # response round's completion can run concurrently with the next round's
        # creation; without this lock the two interleave their flush/commit on a
        # single AsyncSession and one round's status update is silently dropped
        # (leaving e.g. the follow-up response round stuck in ``running``).
        self._round_write_lock = asyncio.Lock()

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
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=1, phase="initial", request_id=str(ctx.turn_id))

        await self._complete_round(round_record, ctx, results)
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
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=2, phase="critique", request_id=str(ctx.turn_id))

        await self._complete_round(round_record, ctx, results)
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
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=3, phase="final_synthesis", request_id=str(ctx.turn_id))

        # Step 37: neutral moderator aggregation across the three syntheses.
        # Best-effort — verdict failure must not fail the whole round.
        await self._generate_synthesis_verdict(
            ctx=ctx,
            round_record=round_record,
            cycle_number=1,
            agent_syntheses=results,
            followup_question=None,
            debate_summary=None,
        )

        await self._complete_round(round_record, ctx, results)
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Public execution methods — 5-stage traceable debate pipeline (Stage 3-4)
    # ─────────────────────────────────────────────────────────────────────────

    async def execute_round_final(
        self,
        ctx: TurnContext,
        round1_results: list[AgentRoundResult],
        round2_results: list[AgentRoundResult],
        revised_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Stage 5 — Final Synthesis using revised positions.

        Same as execute_round_3 but uses revised positions (Stage 4) as the
        primary input rather than initial positions. This ensures the final
        answer reflects debate-driven revisions.
        """
        round_record = await self._create_round(
            ctx,
            round_number=5,
            round_type=RoundType.final,
        )

        # Build a richer digest that includes revised positions
        r1_by_id: dict[str, AgentRoundResult] = {str(r.agent_id): r for r in round1_results}
        debate_digest = _build_final_synthesis_digest(
            question=ctx.question,
            round1_results=round1_results,
            round2_results=round2_results,
            revised_results=revised_results,
        )
        debate_digest_text = json.dumps(debate_digest, ensure_ascii=False)

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            # Use initial position for the "original stance" field
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
            reason = "All agents failed in final synthesis round."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise FinalSynthesisFailed(
                reason,
                results=results,
                request_id=str(ctx.turn_id),
            )

        verdict = await self._generate_synthesis_verdict(
            ctx=ctx,
            round_record=round_record,
            cycle_number=1,
            agent_syntheses=results,
            followup_question=None,
            debate_summary=None,
        )

        verdict_payload: dict[str, Any] = {}
        if verdict is not None:
            try:
                parsed_verdict = json.loads(verdict.content)
                if isinstance(parsed_verdict, dict):
                    verdict_payload = parsed_verdict
            except (TypeError, json.JSONDecodeError):
                verdict_payload = {}
        if verdict is None or verdict_payload.get("generation_status") == "failed":
            reason = "Final synthesis failed after agent responses were generated."
            await self._partially_complete_round(round_record, ctx, results)
            raise FinalSynthesisFailed(
                reason,
                results=results,
                request_id=str(ctx.turn_id),
            )

        await self._complete_round(round_record, ctx, results)
        return results

    async def execute_round_critique_response(
        self,
        ctx: TurnContext,
        round_number: int,
        round1_results: list[AgentRoundResult],
        round2_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """Stage 3 — Critique Response: each agent explicitly responds to critiques received.

        This makes the debate traceable: every critique has an explicit response
        with accepted/rejected points and a planned revision.
        """
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.critique_response,
        )

        # Build mapping: target_agent_role → list of critique dicts
        critiques_by_target: dict[str, list[dict[str, Any]]] = {}
        for r2 in round2_results:
            if r2.generation_status not in ("success",):
                continue
            target = (r2.structured.get("target_agent") or "").strip()
            if not target:
                continue
            critique_dict: dict[str, Any] = {
                "from_role": r2.role,
                "from_agent_id": str(r2.agent_id),
                "target_claim": r2.structured.get("challenge", ""),
                "critique_summary": r2.structured.get("short_summary", ""),
                "weakness_found": r2.structured.get("weakness_found", ""),
                "counterargument": r2.structured.get("counterargument", ""),
            }
            critiques_by_target.setdefault(target, []).append(critique_dict)

        r1_by_role: dict[str, AgentRoundResult] = {r.role: r for r in round1_results}

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            critiques = critiques_by_target.get(agent_ctx.role, [])
            own_r1 = r1_by_role.get(agent_ctx.role)
            own_position = _first_non_empty(
                [
                    own_r1.structured.get("main_argument", "") if own_r1 else "",
                    own_r1.structured.get("short_summary", "") if own_r1 else "",
                    own_r1.structured.get("stance", "") if own_r1 else "",
                ]
            )

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                pos: str = own_position,
                crits: list[dict[str, Any]] = critiques,
            ) -> str:
                return build_critique_response_prompt(
                    role=agent.role,
                    question=ctx.question,
                    own_initial_position=pos,
                    critiques_received=crits,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
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
            reason = "All agents failed in critique response round."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=3, phase="critique_response", request_id=str(ctx.turn_id))

        await self._complete_round(round_record, ctx, results)
        return results

    async def execute_round_revised_position(
        self,
        ctx: TurnContext,
        round_number: int,
        round1_results: list[AgentRoundResult],
        round2_results: list[AgentRoundResult],
        round3_results: list[AgentRoundResult],  # critique_response results
    ) -> list[AgentRoundResult]:
        """Stage 4 — Revised Position: each agent states their updated position.

        Produces explicit before/after evidence per agent. The change_summary and
        reason_for_change fields are the primary traceability artifacts used in
        the Agent Evolution view.
        """
        round_record = await self._create_round(
            ctx,
            round_number=round_number,
            round_type=RoundType.revised_position,
        )

        # Build critique mapping (same as in critique_response round)
        critiques_by_target: dict[str, list[dict[str, Any]]] = {}
        for r2 in round2_results:
            if r2.generation_status not in ("success",):
                continue
            target = (r2.structured.get("target_agent") or "").strip()
            if not target:
                continue
            critique_dict: dict[str, Any] = {
                "from_role": r2.role,
                "from_agent_id": str(r2.agent_id),
                "target_claim": r2.structured.get("challenge", ""),
                "critique_summary": r2.structured.get("short_summary", ""),
                "weakness_found": r2.structured.get("weakness_found", ""),
                "counterargument": r2.structured.get("counterargument", ""),
            }
            critiques_by_target.setdefault(target, []).append(critique_dict)

        r1_by_role: dict[str, AgentRoundResult] = {r.role: r for r in round1_results}
        r3_by_id: dict[str, AgentRoundResult] = {str(r.agent_id): r for r in round3_results}

        plans: list[_AgentTaskPlan] = []
        for agent_index, agent_ctx in enumerate(ctx.agents):
            sequence_no = self.next_seq
            own_r1 = r1_by_role.get(agent_ctx.role)
            own_r3 = r3_by_id.get(str(agent_ctx.agent_id))
            critiques = critiques_by_target.get(agent_ctx.role, [])

            initial_position = _first_non_empty(
                [
                    own_r1.structured.get("main_argument", "") if own_r1 else "",
                    own_r1.structured.get("short_summary", "") if own_r1 else "",
                    own_r1.structured.get("stance", "") if own_r1 else "",
                ]
            )
            initial_key_claims: list[str] = []
            if own_r1:
                kp = own_r1.structured.get("key_points", [])
                if isinstance(kp, list):
                    initial_key_claims = [str(x) for x in kp if str(x or "").strip()][:5]

            critique_response_dict = own_r3.structured if own_r3 else None

            def _build_prompt(
                chunks: list[RetrievedChunk],
                packets: list[EvidencePacket],
                agent: AgentContext = agent_ctx,
                pos: str = initial_position,
                claims: list[str] = initial_key_claims,
                crits: list[dict[str, Any]] = critiques,
                resp: dict[str, Any] | None = critique_response_dict,
            ) -> str:
                return build_revised_position_prompt(
                    role=agent.role,
                    question=ctx.question,
                    initial_position=pos,
                    initial_key_claims=claims,
                    critiques_received=crits,
                    critique_response=resp,
                    reasoning_style=agent.reasoning_style,
                    reasoning_depth=agent.reasoning_depth,
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
            reason = "All agents failed in revised position round."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=4, phase="revised_position", request_id=str(ctx.turn_id))

        await self._complete_round(round_record, ctx, results)
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
                    extra_payload_fields={
                        "followup_question": follow_up_question,
                        "followup_cycle": cycle_number,
                    },
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in follow-up response."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=round_number, phase="follow_up", request_id=str(ctx.turn_id))
        await self._complete_round(round_record, ctx, results)
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
                    extra_payload_fields={
                        "followup_question": follow_up_question,
                        "followup_cycle": cycle_number,
                    },
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
                    await self._fail_round(round_record, reason, ctx=ctx)
                finally:
                    if not all_done_future.done():
                        all_done_future.set_exception(RuntimeError(reason))
                return
            try:
                await self._complete_round(round_record, ctx, gathered)
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
                    extra_payload_fields={
                        "followup_question": follow_up_question,
                        "followup_cycle": cycle_number,
                    },
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in follow-up critique."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=round_number, phase="follow_up", request_id=str(ctx.turn_id))
        await self._complete_round(round_record, ctx, results)
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
                    extra_payload_fields={
                        "followup_question": follow_up_question,
                        "followup_cycle": cycle_number,
                    },
                )
            )

        results = await self._execute_round_parallel(ctx, round_record, plans)
        if self._all_agents_failed(results):
            reason = "All agents failed in updated synthesis."
            await self._fail_round(round_record, reason, ctx=ctx)
            raise RequiredStageFailed(reason, results=results, stage=round_number, phase="follow_up", request_id=str(ctx.turn_id))

        # Step 37: neutral moderator aggregation across the updated syntheses
        # for this follow-up cycle. Best-effort.
        await self._generate_synthesis_verdict(
            ctx=ctx,
            round_record=round_record,
            cycle_number=cycle_number,
            agent_syntheses=results,
            followup_question=follow_up_question,
            debate_summary=debate_summary,
        )

        await self._complete_round(round_record, ctx, results)
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

            # ── Evidence-injection visibility (single consolidated log line).
            # We capture the data once per agent turn so logs can be grepped
            # for "evidence_injection" to audit RAG behavior end-to-end.
            assigned_doc_count = len(plan.agent_ctx.assigned_document_ids or [])
            packet_labels = [p.citation_label for p in packets if p.citation_label]
            prompt_has_block = "AVAILABLE EVIDENCE" in prompt
            logger.info(
                "evidence_injection: session=%s turn=%s round=%d cycle=%d "
                "agent=%s role=%s knowledge_mode=%s assigned_docs=%d "
                "retrieved_chunks=%d evidence_packets=%d labels=%s "
                "prompt_has_evidence_block=%s",
                ctx.session_id,
                ctx.turn_id,
                round_record.round_number,
                plan.cycle_number,
                plan.agent_ctx.agent_id,
                plan.agent_ctx.role,
                plan.agent_ctx.knowledge_mode,
                assigned_doc_count,
                len(chunks),
                len(packets),
                packet_labels or "[]",
                prompt_has_block,
            )
            # Warn loudly when documents are configured but nothing was
            # retrieved — this is the most common silent-failure mode.
            if (
                plan.agent_ctx.knowledge_mode != "no_docs"
                and not chunks
            ):
                logger.warning(
                    "evidence_injection: NO chunks retrieved despite "
                    "knowledge_mode=%s (session=%s agent=%s role=%s). "
                    "Check /api/documents/rag-health and confirm documents "
                    "are status=ready with non-null embeddings.",
                    plan.agent_ctx.knowledge_mode,
                    ctx.session_id,
                    plan.agent_ctx.agent_id,
                    plan.agent_ctx.role,
                )

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
                evidence_packets=packets,
                extra_payload_fields=plan.extra_payload_fields,
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
        bind = db.bind
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
        async with self._round_write_lock:
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

    async def _complete_round(
        self,
        round_record: Round,
        ctx: TurnContext,
        results: list[AgentRoundResult] | None = None,
    ) -> None:
        """Complete a round while preserving partial agent success."""
        has_failed = bool(results) and any(r.generation_status != "success" for r in results)
        has_success = bool(results) and any(r.generation_status == "success" for r in results)
        status = (
            RoundStatus.partially_completed
            if has_failed and has_success
            else RoundStatus.completed
        )
        async with self._round_write_lock:
            round_record.status = status
            round_record.ended_at = datetime.now(timezone.utc)
            await self.db.flush()
            await self.db.commit()

        logger.info("Round %d completed with status=%s.", round_record.round_number, status.value)
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
                    payload={"status": status.value},
                )
            )

    async def _partially_complete_round(
        self,
        round_record: Round,
        ctx: TurnContext,
        results: list[AgentRoundResult],
    ) -> None:
        """Persist usable agent output when a synthesis sub-phase fails."""
        async with self._round_write_lock:
            round_record.status = RoundStatus.partially_completed
            round_record.ended_at = datetime.now(timezone.utc)
            await self.db.flush()
            await self.db.commit()

        if self._on_event is not None:
            await self._on_event(
                ExecutionEvent(
                    event_type=ExecutionEventType.round_completed,
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    round_number=round_record.round_number,
                    payload={
                        "status": RoundStatus.partially_completed.value,
                        "successful_agents": [
                            r.role for r in results if r.generation_status == "success"
                        ],
                        "failed_agents": [
                            r.role for r in results if r.generation_status != "success"
                        ],
                    },
                )
            )

    async def _fail_round(
        self,
        round_record: Round,
        reason: str,
        *,
        ctx: "TurnContext | None" = None,
        safe_error: "DebateSafeError | None" = None,
    ) -> None:
        """Transition round: running → failed and emit round_failed event."""
        async with self._round_write_lock:
            round_record.status = RoundStatus.failed
            round_record.ended_at = datetime.now(timezone.utc)
            await self.db.flush()
            await self.db.commit()
        logger.error("Round %d failed: %s", round_record.round_number, reason)

        if self._on_event is not None and ctx is not None:
            # Build a safe error if none was provided
            if safe_error is None:
                safe_error = make_safe_error(
                    ROUND_ALL_AGENTS_FAILED,
                    round_number=round_record.round_number,
                    round_type=(
                        round_record.round_type.value
                        if round_record.round_type is not None
                        else None
                    ),
                )
            logger.info(
                "WS emit round_failed round=%d turn=%s code=%s debug_id=%s",
                round_record.round_number,
                ctx.turn_id,
                safe_error.code,
                safe_error.debug_id,
            )
            try:
                await self._on_event(
                    ExecutionEvent(
                        event_type=ExecutionEventType.round_failed,
                        session_id=ctx.session_id,
                        turn_id=ctx.turn_id,
                        round_id=round_record.id,
                        round_number=round_record.round_number,
                        payload={
                            "round_id": str(round_record.id),
                            "round_number": round_record.round_number,
                            "round_type": (
                                round_record.round_type.value
                                if round_record.round_type is not None
                                else None
                            ),
                            "error": safe_error.to_frontend_dict(),
                        },
                    )
                )
            except Exception:
                logger.exception(
                    "Failed to emit round_failed WS event (round=%d)",
                    round_record.round_number,
                )

    # ─────────────────────────────────────────────────────────────────────────
    # Step 37 — Synthesis Verdict (neutral moderator aggregation)
    # ─────────────────────────────────────────────────────────────────────────

    async def _generate_synthesis_verdict(
        self,
        ctx: TurnContext,
        round_record: Round,
        cycle_number: int,
        agent_syntheses: list[AgentRoundResult],
        followup_question: str | None = None,
        debate_summary: dict[str, Any] | None = None,
    ) -> Message | None:
        """Run a single moderator-aggregator LLM call and persist the verdict.

        The verdict message is attached to the existing synthesis round
        (round 3 for cycle 1, the updated_synthesis round for follow-ups)
        with ``sender_type=judge``, ``message_type=final_summary`` and
        ``chat_agent_id=NULL``. The structured payload also embeds
        ``message_type="synthesis_verdict"`` and ``agent_role="moderator"``
        so frontend consumers can identify it without extra schema.

        Best-effort: any error is logged and swallowed so the round can
        still complete with the per-agent summaries.
        """
        if not ctx.agents:
            return None

        successful = [
            r for r in agent_syntheses
            if r.generation_status == "success" and isinstance(r.structured, dict) and r.structured
        ]
        if not successful:
            logger.info(
                "Synthesis verdict skipped: no successful syntheses (round=%d, cycle=%d).",
                round_record.round_number,
                cycle_number,
            )
            return None

        round_type_value = (
            round_record.round_type.value
            if round_record.round_type is not None
            else "final"
        )
        is_followup_cycle = cycle_number > 1 or round_type_value == "updated_synthesis"

        # Dedicated moderator config — always uses the settings-defined model
        # regardless of which agent models were chosen for the debate itself.
        # This ensures the final synthesis/verdict is always produced by a
        # known, high-quality model and never silently inherits a cheap/fast
        # agent model that may have been selected for debate rounds.
        moderator_provider = settings.MODERATOR_PROVIDER
        moderator_model = settings.MODERATOR_MODEL
        moderator_temperature = settings.MODERATOR_TEMPERATURE

        agent_payload_blocks = [
            {"role": r.role, "structured": r.structured}
            for r in successful
        ]

        # Best-effort evidence detection — any agent payload that records
        # cited sources flips the prompt into evidence mode.
        has_evidence = False
        for r in successful:
            sources = r.structured.get("evidence_used") or r.structured.get(
                "cited_sources"
            )
            if isinstance(sources, list) and sources:
                has_evidence = True
                break

        prompt = build_synthesis_verdict_prompt(
            original_question=ctx.question,
            cycle_number=cycle_number,
            round_type=round_type_value,
            agent_syntheses=agent_payload_blocks,
            debate_summary=debate_summary,
            followup_question=followup_question,
            has_evidence=has_evidence,
        )

        request = LLMRequest(
            provider=moderator_provider,
            model=moderator_model,
            prompt=prompt,
            temperature=moderator_temperature,
            max_tokens=settings.MODERATOR_MAX_TOKENS,
        )

        sequence_no = self.next_seq
        verdict_started_at = datetime.now(timezone.utc)

        raw_content = ""
        normalized_payload: dict[str, Any] = {}
        generation_status = "success"
        error_msg: str | None = None

        try:
            logger.info(
                "FINAL_SYNTHESIS_MODEL provider=%s model=%s temperature=%s max_tokens=%s round=%s cycle=%s",
                moderator_provider,
                moderator_model,
                moderator_temperature,
                settings.MODERATOR_MAX_TOKENS,
                round_record.round_number,
                cycle_number,
            )
            logger.info(
                "MODERATOR_PROMPT round=%d cycle=%d: %s",
                round_record.round_number,
                cycle_number,
                prompt[:1500],
            )
            response = await self._llm.generate(request)
            raw_content = (response.content or "").strip()
            if not raw_content:
                raise LLMError("Moderator returned an empty response.")

            normalized = normalize_round_output(
                round_number=round_record.round_number,
                raw_text=raw_content,
                round_type="synthesis_verdict",
            )

            # Two-stage recovery if JSON parsing collapsed to fallback.
            if normalized.payload.get("is_fallback") is True:
                try:
                    recovered = await recover_json_with_llm(
                        raw_content,
                        round_number=round_record.round_number,
                        round_type="synthesis_verdict",
                        llm_call=self._raw_llm_call,
                        provider=moderator_provider,
                        model=moderator_model,
                        temperature=0.0,
                        max_tokens=900,
                    )
                except Exception as recovery_exc:  # noqa: BLE001
                    logger.warning(
                        "Synthesis verdict two-stage recovery raised: %s — keeping fallback.",
                        recovery_exc,
                    )
                    recovered = None

                if recovered is not None:
                    try:
                        recovered_normalized = normalize_round_output(
                            round_number=round_record.round_number,
                            raw_text=raw_content,
                            parsed_payload=recovered,
                            round_type="synthesis_verdict",
                        )
                    except Exception as renorm_exc:  # noqa: BLE001
                        logger.warning(
                            "Synthesis verdict recovery normalization raised: %s.",
                            renorm_exc,
                        )
                    else:
                        if recovered_normalized.payload.get("is_fallback") is False:
                            normalized = recovered_normalized

            logger.info(
                "MODERATOR_RESPONSE round=%d cycle=%d: %s",
                round_record.round_number,
                cycle_number,
                raw_content[:1500],
            )

            # Phase 2/6: leak + quality guard on the verdict. Regenerate once if
            # prompt / schema / role / formatting text leaked into the verdict.
            verdict_report = evaluate_round_quality(
                round_number=round_record.round_number,
                round_type="synthesis_verdict",
                payload=normalized.payload,
            )
            if not verdict_report.ok:
                logger.warning(
                    "QUALITY_GUARD moderator round=%d cycle=%d issues=%s",
                    round_record.round_number,
                    cycle_number,
                    verdict_report.summary,
                )
            if verdict_report.has_leak:
                logger.warning(
                    "PROMPT_LEAK_DETECTED moderator round=%d cycle=%d codes=%s — regenerating once.",
                    round_record.round_number,
                    cycle_number,
                    verdict_report.leak_codes,
                )
                corrective_request = request.model_copy(
                    update={"prompt": prompt + _LEAK_CORRECTION_SUFFIX}
                )
                try:
                    retry_response = await self._llm.generate(corrective_request)
                    retry_raw = (retry_response.content or "").strip()
                except Exception as retry_exc:  # noqa: BLE001
                    logger.warning(
                        "Moderator leak-correction regeneration raised: %s — keeping original.",
                        retry_exc,
                    )
                    retry_raw = ""
                if retry_raw:
                    retry_normalized = normalize_round_output(
                        round_number=round_record.round_number,
                        raw_text=retry_raw,
                        round_type="synthesis_verdict",
                    )
                    retry_report = evaluate_round_quality(
                        round_number=round_record.round_number,
                        round_type="synthesis_verdict",
                        payload=retry_normalized.payload,
                    )
                    if not retry_report.has_leak:
                        logger.info(
                            "Moderator leak-correction regeneration succeeded (round=%d cycle=%d).",
                            round_record.round_number,
                            cycle_number,
                        )
                        normalized = retry_normalized
                        raw_content = retry_raw

            normalized_payload = normalized.payload
        except LLMError as exc:
            error_msg = str(exc)
            generation_status = "failed"
            logger.warning(
                "Synthesis verdict failed (round=%d cycle=%d): %s",
                round_record.round_number,
                cycle_number,
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            error_msg = f"Unhandled moderator error: {exc}"
            generation_status = "failed"
            logger.exception(
                "Synthesis verdict crashed (round=%d cycle=%d).",
                round_record.round_number,
                cycle_number,
            )

        if generation_status == "failed":
            normalized_payload = {
                "one_sentence_takeaway": "",
                "consensus_statement": "",
                "main_disagreement": "",
                "recommended_answer": "",
                "winning_side": "mixed",
                "confidence": "low",
                "what_changed": "",
                "reasoning_basis": [],
                "unresolved_questions": [],
                "response": "",
                "is_fallback": True,
                "parse_status": "fallback",
                "parse_warnings": ["synthesis_verdict_generation_failed"],
                "raw_content": raw_content,
            }
            if error_msg:
                normalized_payload["error"] = error_msg

        # Always embed the discriminator + cycle context so the frontend
        # can identify this as the moderator verdict without a DB schema
        # change.
        normalized_payload["message_type"] = "synthesis_verdict"
        normalized_payload["agent_role"] = "moderator"
        normalized_payload["cycle_number"] = cycle_number
        normalized_payload["round_number"] = round_record.round_number
        if followup_question:
            normalized_payload["followup_question"] = followup_question
            normalized_payload["followup_cycle"] = cycle_number

        # Moderator metadata — additive only, never overwrites existing fields.
        # Frontend consumers can display these without breaking old debates.
        normalized_payload["moderator_provider"] = moderator_provider
        normalized_payload["moderator_model"] = moderator_model
        normalized_payload["moderator_temperature"] = moderator_temperature
        normalized_payload["moderator_max_tokens"] = settings.MODERATOR_MAX_TOKENS
        normalized_payload["generation_status"] = generation_status

        content_json = json.dumps(normalized_payload, ensure_ascii=False)

        try:
            msg = await self._save_message(
                db=self.db,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                round_id=round_record.id,
                agent_id=None,
                sender_type=SenderType.judge,
                message_type=MessageType.final_summary,
                content=content_json,
                sequence_no=sequence_no,
            )
            await self.db.commit()
        except Exception:
            logger.exception(
                "Failed to persist synthesis verdict message (round=%d cycle=%d).",
                round_record.round_number,
                cycle_number,
            )
            return None

        verdict_finished_at = datetime.now(timezone.utc)
        logger.info(
            "Synthesis verdict persisted: round=%d cycle=%d status=%s duration_ms=%d msg=%s",
            round_record.round_number,
            cycle_number,
            generation_status,
            int((verdict_finished_at - verdict_started_at).total_seconds() * 1000),
            msg.id,
        )

        if self._on_event is not None:
            event_payload: dict[str, Any] = {
                "message_id": str(msg.id),
                "round_id": str(round_record.id),
                "sender_type": SenderType.judge.value,
                "message_type": MessageType.final_summary.value,
                "content": content_json,
                "sequence_no": sequence_no,
                "generation_status": generation_status,
                "agent_role": "moderator",
                "agent_index": -1,
                "cycle_number": cycle_number,
                "is_synthesis_verdict": True,
                "is_followup_cycle": is_followup_cycle,
            }
            short_summary = normalized_payload.get("short_summary") or normalized_payload.get(
                "one_sentence_takeaway"
            )
            display_content = normalized_payload.get("display_content") or normalized_payload.get(
                "response"
            )
            if isinstance(short_summary, str) and short_summary.strip():
                event_payload["short_summary"] = short_summary
            if isinstance(display_content, str) and display_content.strip():
                event_payload["display_content"] = display_content
            is_fallback = normalized_payload.get("is_fallback")
            if isinstance(is_fallback, bool):
                event_payload["is_fallback"] = is_fallback
            if followup_question:
                event_payload["followup_question"] = followup_question

            try:
                await self._on_event(
                    ExecutionEvent(
                        event_type=ExecutionEventType.message_created,
                        session_id=ctx.session_id,
                        turn_id=ctx.turn_id,
                        round_id=round_record.id,
                        round_number=round_record.round_number,
                        agent_id=None,
                        payload=event_payload,
                    )
                )
            except Exception:
                logger.exception(
                    "Failed to emit synthesis verdict WS event (round=%d cycle=%d).",
                    round_record.round_number,
                    cycle_number,
                )

        return msg

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
        packets: list[EvidencePacket] | None = None,
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

        # Build a {document_id: [labels]} map from the supplied packets so the
        # UI can show which [E#] labels were derived from each source.
        labels_by_doc: dict[uuid.UUID, list[str]] = {}
        for p in packets or []:
            if p.citation_label:
                labels_by_doc.setdefault(p.document_id, []).append(p.citation_label)

        documents = [
            {
                "document_id": str(doc_id),
                "document_name": names.get(doc_id, "Untitled document"),
                "chunks": grouped[doc_id],
                "evidence_labels": labels_by_doc.get(doc_id, []),
            }
            for doc_id in order
        ]
        all_labels = [lbl for labels in labels_by_doc.values() for lbl in labels]
        return {
            "documents": documents,
            "total_chunks": len(capped),
            "evidence_labels": all_labels,
        }

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
        evidence_packets: list[EvidencePacket] | None = None,
        extra_payload_fields: dict[str, Any] | None = None,
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

        # Phase 7 diagnostic: log the prompt actually sent (first 1500 chars).
        logger.info(
            "ROUND_%d_PROMPT agent=%s role=%s type=%s: %s",
            round_record.round_number,
            agent_ctx.agent_id,
            agent_ctx.role,
            message_type.value,
            prompt[:1500],
        )

        content = ""
        structured: dict[str, Any] = {}
        generation_status = "success"
        error_msg: str | None = None
        failure_reason: str | None = None
        _agent_safe_error: "DebateSafeError | None" = None
        prompt_tokens = 0
        completion_tokens = 0
        provider_latency_ms = 0

        try:
            # Retry once on empty response — common on Groq when rate-limited
            # or when the model stalls on a complex synthesis prompt.
            _empty_retries = 2
            response = None
            for _attempt in range(_empty_retries):
                response = await self._llm.generate(request)
                if response.content and response.content.strip():
                    break
                if _attempt < _empty_retries - 1:
                    logger.warning(
                        "Empty response on attempt %d/%d for agent=%s round=%d — retrying",
                        _attempt + 1, _empty_retries, agent_ctx.role, round_record.round_number,
                    )
                    await asyncio.sleep(1.5)
            raw_content = response.content  # type: ignore[union-attr]
            prompt_tokens = response.prompt_tokens  # type: ignore[union-attr]
            completion_tokens = response.completion_tokens  # type: ignore[union-attr]
            provider_latency_ms = response.latency_ms  # type: ignore[union-attr]

            # FIX-05: log when the provider truncated the response because the
            # token budget was exhausted. ``finish_reason`` is best-effort:
            # not every LLM client exposes it, so we read defensively.
            finish_reason = getattr(response, "finish_reason", None) or getattr(
                response, "stop_reason", None
            )
            if finish_reason == "length":
                logger.warning(
                    "LLM response truncated by max_tokens budget: "
                    "turn=%s round=%d agent=%s role=%s budget=%d completion_tokens=%d",
                    turn_id,
                    round_record.round_number,
                    agent_ctx.agent_id,
                    agent_ctx.role,
                    request.max_tokens,
                    completion_tokens,
                )

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

            # Phase 7 diagnostic: log the raw model response (first 1500 chars).
            logger.info(
                "ROUND_%d_RESPONSE agent=%s role=%s type=%s: %s",
                round_record.round_number,
                agent_ctx.agent_id,
                agent_ctx.role,
                message_type.value,
                (raw_content or "")[:1500],
            )

            # Phase 2/6: prompt-leak + quality guard. If the answer leaked
            # prompt / schema / role / formatting text, regenerate once with a
            # strict corrective instruction and re-normalize. Quality-only
            # issues are logged for observability but never force a retry, to
            # avoid over-rejecting otherwise valid debates.
            rt_value = (
                round_record.round_type.value
                if round_record.round_type is not None
                else None
            )
            quality_report = evaluate_round_quality(
                round_number=round_record.round_number,
                round_type=rt_value,
                payload=normalized.payload,
            )
            if not quality_report.ok:
                logger.warning(
                    "QUALITY_GUARD agent=%s round=%d type=%s issues=%s",
                    agent_ctx.agent_id,
                    round_record.round_number,
                    message_type.value,
                    quality_report.summary,
                )
            if quality_report.has_leak:
                logger.warning(
                    "PROMPT_LEAK_DETECTED agent=%s round=%d codes=%s — regenerating once.",
                    agent_ctx.agent_id,
                    round_record.round_number,
                    quality_report.leak_codes,
                )
                corrective_request = request.model_copy(
                    update={
                        "prompt": prompt + _LEAK_CORRECTION_SUFFIX,
                        "temperature": min(0.4, request.temperature),
                    }
                )
                try:
                    retry_response = await self._llm.generate(corrective_request)
                    retry_raw = retry_response.content or ""
                except Exception as retry_exc:  # noqa: BLE001
                    logger.warning(
                        "Leak-correction regeneration raised: %s — keeping original answer.",
                        retry_exc,
                    )
                    retry_raw = ""
                if retry_raw.strip():
                    retry_normalized = normalize_round_output(
                        round_number=round_record.round_number,
                        raw_text=retry_raw,
                        round_type=rt_value,
                    )
                    retry_report = evaluate_round_quality(
                        round_number=round_record.round_number,
                        round_type=rt_value,
                        payload=retry_normalized.payload,
                    )
                    if not retry_report.has_leak:
                        logger.info(
                            "Leak-correction regeneration succeeded for agent %s round %d.",
                            agent_ctx.agent_id,
                            round_record.round_number,
                        )
                        normalized = retry_normalized
                        raw_content = retry_raw
                        completion_tokens += retry_response.completion_tokens
                    else:
                        logger.warning(
                            "Leak persisted after regeneration for agent %s round %d codes=%s.",
                            agent_ctx.agent_id,
                            round_record.round_number,
                            retry_report.leak_codes,
                        )

            # Phase 2/3/4: strict structured-output validation. If the final
            # normalized payload is empty / fell back / placeholder / missing
            # required fields, attempt (1) a same-model strict retry, then
            # (2) a moderator-based JSON repair. If both fail, mark the node as
            # failed so malformed content is never displayed or fed forward.
            structured_reasons = validate_structured_output(
                normalized.payload,
                round_number=round_record.round_number,
                round_type=rt_value,
                raw_content=raw_content,
            )
            if structured_reasons:
                logger.warning(
                    "STRUCTURED_GUARD agent=%s round=%d type=%s reasons=%s — attempting recovery.",
                    agent_ctx.agent_id,
                    round_record.round_number,
                    message_type.value,
                    structured_reasons,
                )

                # (1) Same-model strict retry at a lower temperature.
                strict_request = request.model_copy(
                    update={
                        "prompt": prompt + _STRUCTURED_CORRECTION_SUFFIX,
                        "temperature": min(0.2, request.temperature),
                    }
                )
                try:
                    strict_response = await self._llm.generate(strict_request)
                    strict_raw = strict_response.content or ""
                except Exception as strict_exc:  # noqa: BLE001
                    logger.warning(
                        "Structured-correction retry raised: %s.", strict_exc
                    )
                    strict_raw = ""
                if strict_raw.strip():
                    strict_normalized = normalize_round_output(
                        round_number=round_record.round_number,
                        raw_text=strict_raw,
                        round_type=rt_value,
                    )
                    if not validate_structured_output(
                        strict_normalized.payload,
                        round_number=round_record.round_number,
                        round_type=rt_value,
                        raw_content=strict_raw,
                    ):
                        logger.info(
                            "Structured-correction retry succeeded for agent %s round %d.",
                            agent_ctx.agent_id,
                            round_record.round_number,
                        )
                        normalized = strict_normalized
                        raw_content = strict_raw
                        completion_tokens += getattr(
                            strict_response, "completion_tokens", 0
                        )
                        structured_reasons = []

                # (2) Moderator-based JSON repair (extract/format only).
                if structured_reasons:
                    try:
                        repaired_payload = await repair_structured_output_with_moderator(
                            raw_content,
                            round_number=round_record.round_number,
                            round_type=rt_value,
                            llm_call=self._raw_llm_call,
                            provider=settings.MODERATOR_PROVIDER,
                            model=settings.MODERATOR_MODEL,
                            temperature=0.0,
                            max_tokens=900,
                        )
                    except Exception as repair_exc:  # noqa: BLE001
                        logger.warning(
                            "Moderator JSON repair raised: %s.", repair_exc
                        )
                        repaired_payload = None
                    if repaired_payload is not None:
                        repaired_normalized = normalize_round_output(
                            round_number=round_record.round_number,
                            raw_text=raw_content,
                            parsed_payload=repaired_payload,
                            round_type=rt_value,
                        )
                        if not validate_structured_output(
                            repaired_normalized.payload,
                            round_number=round_record.round_number,
                            round_type=rt_value,
                            raw_content=raw_content,
                        ):
                            logger.info(
                                "Moderator JSON repair succeeded for agent %s round %d.",
                                agent_ctx.agent_id,
                                round_record.round_number,
                            )
                            normalized = repaired_normalized
                            structured_reasons = []

                # (3) Give up: mark the node as failed so malformed content is
                # neither displayed nor used as evidence in later rounds.
                if structured_reasons:
                    # Classify the failure code based on the specific reasons.
                    # json_parse_failed / empty_response  → MODEL_INVALID_JSON or MODEL_EMPTY_RESPONSE.
                    # Everything else (missing fields, placeholder, too short) → STRUCTURED_VALIDATION_FAILED.
                    if "empty_response" in structured_reasons:
                        _struct_code = MODEL_EMPTY_RESPONSE
                    elif "json_parse_failed_used_text_fallback" in structured_reasons:
                        _struct_code = MODEL_INVALID_JSON
                    else:
                        _struct_code = STRUCTURED_VALIDATION_FAILED

                    logger.warning(
                        "STRUCTURED_GUARD_FAILED agent=%s round=%d reasons=%s code=%s — marking node failed.",
                        agent_ctx.agent_id,
                        round_record.round_number,
                        structured_reasons,
                        _struct_code,
                    )
                    generation_status = "failed"
                    failure_reason = "malformed_structured_output"
                    error_msg = (
                        "Model returned malformed structured output: "
                        + ", ".join(structured_reasons)
                    )
                    _agent_safe_error = make_safe_error(
                        _struct_code,
                        message=error_msg,
                        provider=agent_ctx.provider,
                        model=agent_ctx.model,
                        agent_id=str(agent_ctx.agent_id),
                        agent_name=agent_ctx.role,
                        round_number=round_record.round_number,
                        round_type=(
                            round_record.round_type.value
                            if round_record.round_type is not None
                            else None
                        ),
                    )

            structured = normalized.payload

            # FIX-09: persist extra payload fields (e.g. follow-up question /
            # cycle number) so every saved message carries the context that
            # produced it. We use setdefault so an LLM that already returned
            # the field wins.
            if extra_payload_fields:
                for key, value in extra_payload_fields.items():
                    if key not in structured or structured[key] in (None, "", []):
                        structured[key] = value
            content = json.dumps(normalized.payload, ensure_ascii=False)

        except LLMError as exc:
            error_msg = str(exc)
            content = json.dumps({"error": error_msg})
            generation_status = "failed"
            # Prefer a pre-classified safe_error attached by the provider wrapper.
            # If none (e.g. internally-raised LLMError for empty response), classify now.
            _agent_safe_error = getattr(exc, "safe_error", None)
            if _agent_safe_error is None:
                _agent_safe_error = classify_provider_error(
                    exc,
                    provider=agent_ctx.provider,
                    model=agent_ctx.model,
                    agent_id=str(agent_ctx.agent_id),
                    agent_name=agent_ctx.role,
                    round_number=round_record.round_number,
                    round_type=(
                        round_record.round_type.value
                        if round_record.round_type is not None
                        else None
                    ),
                )
            failure_reason = _agent_safe_error.code
            logger.warning(
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
            _agent_safe_error = getattr(exc, "safe_error", None)
            failure_reason = "unknown"
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
            retrieval_summary = await self._build_retrieval_summary(
                db, retrieved_chunks, packets=evidence_packets
            )

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
            if failure_reason is not None:
                event_payload["failure_reason"] = failure_reason
            if generation_status == "failed":
                # Attach a safe error object so the frontend can show a structured
                # failure reason without raw tracebacks or API key exposure.
                # _agent_safe_error is always set by the time we reach here:
                # - structured guard path: set explicitly above
                # - LLMError path: set via classify_provider_error above
                # - Exception path: may still be None if exception had no .safe_error
                _safe = _agent_safe_error if _agent_safe_error is not None else make_safe_error(
                    UNKNOWN_ERROR,
                    message=error_msg or "Agent generation failed",
                    provider=agent_ctx.provider,
                    model=agent_ctx.model,
                    agent_id=str(agent_ctx.agent_id),
                    agent_name=agent_ctx.role,
                    round_number=round_record.round_number,
                    round_type=(
                        round_record.round_type.value
                        if round_record.round_type is not None
                        else None
                    ),
                )
                event_payload["safe_error"] = _safe.to_frontend_dict()
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
            failure_reason=failure_reason,
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


def _build_final_synthesis_digest(
    question: str,
    round1_results: list[AgentRoundResult],
    round2_results: list[AgentRoundResult],
    revised_results: list[AgentRoundResult],
) -> dict[str, Any]:
    """Build a richer debate digest that includes revised positions.

    Used by execute_round_final (Stage 5) to ensure the final synthesis is
    based primarily on revised positions rather than initial answers.
    """
    # Build base digest from rounds 1+2
    base = _build_round3_digest(question=question, round1_results=round1_results, round2_results=round2_results)

    # Add revised positions
    revised_items: list[dict[str, Any]] = []
    for r in revised_results:
        if r.generation_status not in ("success",):
            continue
        revised_items.append(
            {
                "agent": r.role,
                "revised_position": _clip_text(
                    _first_non_empty(
                        [
                            r.structured.get("revised_position", ""),
                            r.structured.get("response", ""),
                        ]
                    ),
                    300,
                ),
                "change_summary": _clip_text(
                    r.structured.get("change_summary", ""),
                    200,
                ),
                "changed": r.structured.get("changed", False),
                "change_type": r.structured.get("change_type", ""),
                "reason_for_change": _clip_text(
                    r.structured.get("reason_for_change", ""),
                    200,
                ),
                "key_claims": [
                    _clip_text(str(c), 150)
                    for c in (r.structured.get("key_claims") or [])
                    if str(c or "").strip()
                ][:3],
            }
        )

    return {
        "question": _clip_text(question, 400),
        "round1": base["round1"],
        "round2": base["round2"],
        "revised_positions": revised_items,
        "note": "Final synthesis must primarily reference revised_positions, not round1.",
    }


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
