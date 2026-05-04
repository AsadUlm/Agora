"""
Round Manager — executes a single round within a ChatTurn.

Responsibilities:
  1. Create the Round DB record and manage its lifecycle (queued → running → completed/failed)
  2. Call RetrievalService (RAG hook) before each round
  3. Call the LLM provider per agent and log each LLMCall record
  4. Save one Message per agent per round (correct sender_type / message_type)
  5. Return a list of AgentRoundResult for the ChatEngine to aggregate

Architecture:
    ChatEngine
        └── RoundManager.execute_round_{1,2,3}()
                ├── RetrievalService.retrieve()   (RAG hook — stubbed until Step 5)
                ├── _call_llm()                   (calls provider, logs LLMCall)
                └── _save_message()               (saves Message to DB)

Key design rules:
  - RoundManager owns ALL database writes for round, message, llm_call tables.
  - LLMService (provider) is stateless: call in → response out. No DB access.
  - One Message row per agent per round (chat_agent_id always set for agent messages).
  - sequence_no is tracked as an instance counter that starts at 0 and rises monotonically
    across all rounds within a single turn (passes through ChatEngine).
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.llm.exceptions import LLMError, LLMParseError
from app.services.llm.parser import parse_json_from_llm
from app.services.llm.service import LLMService, get_llm_service
from app.services.retrieval.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)

# ── LLM output budget ────────────────────────────────────────────────────────
# Hard ceiling for any single LLM call. Keeping this lower reduces credit
# reservation and median latency spikes for long completions.
MAX_ALLOWED_TOKENS = 1200

# Per-round output budget. Round 1 is a tight opening statement; Rounds 2 and 3
# need extra headroom for critiques and synthesis.
ROUND_MAX_TOKENS: dict[int, int] = {
    1: 650,
    2: 850,
    3: 900,
}
DEFAULT_MAX_TOKENS = 850
RETRIEVAL_TOP_K = 3


def _resolve_max_tokens(round_number: int) -> int:
    """Return the clamped max_tokens budget for a given round."""
    budget = ROUND_MAX_TOKENS.get(round_number, DEFAULT_MAX_TOKENS)
    return min(budget, MAX_ALLOWED_TOKENS)


def _estimate_tokens_from_chars(char_count: int) -> int:
    """Quick token estimate for logging and perf diagnostics."""
    return max(1, int(char_count / 4))

logger = logging.getLogger(__name__)


class RoundManager:
    """
    Executes one round (1, 2, or 3) within a debate turn.

    Instantiated once per ChatTurn by the ChatEngine.
    The `seq` counter ensures messages are globally ordered within the turn.
    """

    def __init__(
        self,
        db: AsyncSession,
        seq_start: int = 0,
        on_event: OnEventCallback | None = None,
        step_controller: Any = None,
    ) -> None:
        self.db = db
        self._seq = seq_start                     # monotonic message sequence counter
        self._retrieval = RetrievalService()
        self._llm: LLMService = get_llm_service()
        self._on_event = on_event
        self._step_controller = step_controller   # optional StepController for manual mode

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
        """
        Round 1 — Opening Statements.

        Each agent independently generates:
          • stance
          • key_points (3-5)
          • confidence (0.0–1.0)
        """
        round_record = await self._create_round(ctx, round_number=1, round_type=RoundType.initial)
        results: list[AgentRoundResult] = []

        for agent_ctx in ctx.agents:
            chunks = await self._retrieve_for_agent(ctx, agent_ctx)
            chunk_dicts = [c.model_dump() for c in chunks]
            prompt = build_opening_statement_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
                retrieved_chunks=chunk_dicts,
                knowledge_mode=agent_ctx.knowledge_mode,
                knowledge_strict=agent_ctx.knowledge_strict,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.agent_response,
                retrieved_chunks=chunks,
            )
            results.append(result)

        await self._complete_round(round_record, ctx)
        return results

    async def execute_round_2(
        self,
        ctx: TurnContext,
        round1_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """
        Round 2 — Cross Examination.

        Each agent critiques every other agent's Round 1 output.
        Agents that had zero opponents are passed through with an empty critique list.
        """
        round_record = await self._create_round(ctx, round_number=2, round_type=RoundType.critique)
        results: list[AgentRoundResult] = []

        # Build a lookup: agent_id → round1 result for prompt construction
        r1_by_id: dict[str, AgentRoundResult] = {
            str(r.agent_id): r for r in round1_results
        }

        for agent_ctx in ctx.agents:
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            own_stance = own_r1.structured.get("stance", "") if own_r1 else ""

            other_agents = [
                {
                    "role": r.role,
                    "stance": r.structured.get("stance", ""),
                    "key_points": r.structured.get("key_points", []),
                }
                for r in round1_results
                if r.agent_id != agent_ctx.agent_id
            ]

            if not other_agents:
                # Single-agent session — no cross-examination possible
                empty_result = AgentRoundResult(
                    agent_id=agent_ctx.agent_id,
                    role=agent_ctx.role,
                    content="{}",
                    structured={"critiques": []},
                    generation_status="skipped",
                    error="No opponents to critique.",
                )
                msg = await self._save_message(
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    agent_id=agent_ctx.agent_id,
                    sender_type=SenderType.agent,
                    message_type=MessageType.critique,
                    content=empty_result.content,
                )
                if self._on_event is not None:
                    await self._on_event(ExecutionEvent(
                        event_type=ExecutionEventType.message_created,
                        session_id=ctx.session_id,
                        turn_id=ctx.turn_id,
                        round_id=round_record.id,
                        round_number=round_record.round_number,
                        agent_id=agent_ctx.agent_id,
                        payload={
                            "message_id": str(msg.id),
                            "round_id": str(round_record.id),
                            "sender_type": msg.sender_type.value,
                            "message_type": msg.message_type.value,
                            "content": msg.content,
                            "sequence_no": msg.sequence_no,
                            "generation_status": "skipped",
                        },
                    ))
                results.append(empty_result)
                continue

            chunks_r2 = await self._retrieve_for_agent(ctx, agent_ctx)
            prompt = build_critique_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                own_stance=own_stance,
                other_agents=other_agents,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
                retrieved_chunks=[c.model_dump() for c in chunks_r2],
                knowledge_mode=agent_ctx.knowledge_mode,
                knowledge_strict=agent_ctx.knowledge_strict,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.critique,
                retrieved_chunks=chunks_r2,
            )
            results.append(result)

        await self._complete_round(round_record, ctx)
        return results

    async def execute_round_3(
        self,
        ctx: TurnContext,
        round1_results: list[AgentRoundResult],
        round2_results: list[AgentRoundResult],
    ) -> list[AgentRoundResult]:
        """
        Round 3 — Final Synthesis.

        Each agent reflects on the full debate and produces a final verdict.
        """
        round_record = await self._create_round(ctx, round_number=3, round_type=RoundType.final)
        results: list[AgentRoundResult] = []

        r1_by_id: dict[str, AgentRoundResult] = {
            str(r.agent_id): r for r in round1_results
        }

        # Build the debate summary from Round 2 results for the prompt
        debate_summary = _build_debate_summary(round2_results)

        for agent_ctx in ctx.agents:
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            original_stance = own_r1.structured.get("stance", "") if own_r1 else ""

            chunks_r3 = await self._retrieve_for_agent(ctx, agent_ctx)
            prompt = build_final_synthesis_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                original_stance=original_stance,
                debate_summary=debate_summary,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
                retrieved_chunks=[c.model_dump() for c in chunks_r3],
                knowledge_mode=agent_ctx.knowledge_mode,
                knowledge_strict=agent_ctx.knowledge_strict,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.final_summary,
                retrieved_chunks=chunks_r3,
            )
            results.append(result)

        await self._complete_round(round_record, ctx)
        return results

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — DB operations
    # ─────────────────────────────────────────────────────────────────────────

    async def _create_round(
        self,
        ctx: TurnContext,
        round_number: int,
        round_type: RoundType,
    ) -> Round:
        """
        Create a Round record and transition it to running.

        Lifecycle: queued → running  (sync path does both steps immediately).
        In Step 3 (async), the background worker creates the Round as queued via
        the route, then transitions to running when the worker picks it up.
        The two-step flush here preserves the same state machine without branching.
        """
        round_record = Round(
            chat_turn_id=ctx.turn_id,
            round_number=round_number,
            round_type=round_type,
            status=RoundStatus.queued,
        )
        self.db.add(round_record)
        await self.db.flush()

        # Transition: queued → running
        round_record.status = RoundStatus.running
        round_record.started_at = datetime.now(timezone.utc)
        await self.db.flush()

        logger.info(
            "Round %d running (id=%s, turn=%s)",
            round_number,
            round_record.id,
            ctx.turn_id,
        )

        if self._on_event is not None:
            logger.info("WS emit round_started round=%d turn=%s", round_number, ctx.turn_id)
            await self._on_event(ExecutionEvent(
                event_type=ExecutionEventType.round_started,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                round_number=round_number,
            ))

        return round_record

    async def _complete_round(self, round_record: Round, ctx: TurnContext) -> None:
        """Transition round: running → completed and emit round_completed."""
        round_record.status = RoundStatus.completed
        round_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()
        logger.info("Round %d completed.", round_record.round_number)

        if self._on_event is not None:
            logger.info(
                "WS emit round_completed round=%d turn=%s",
                round_record.round_number,
                ctx.turn_id,
            )
            await self._on_event(ExecutionEvent(
                event_type=ExecutionEventType.round_completed,
                session_id=ctx.session_id,
                turn_id=ctx.turn_id,
                round_id=round_record.id,
                round_number=round_record.round_number,
            ))

    async def _fail_round(self, round_record: Round, reason: str) -> None:
        """Transition round: running → failed."""
        round_record.status = RoundStatus.failed
        round_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()
        logger.error("Round %d failed: %s", round_record.round_number, reason)

    async def _save_message(
        self,
        session_id: uuid.UUID,
        turn_id: uuid.UUID,
        round_id: uuid.UUID,
        agent_id: uuid.UUID | None,
        sender_type: SenderType,
        message_type: MessageType,
        content: str,
        visibility: MessageVisibility = MessageVisibility.visible,
    ) -> Message:
        """Persist one Message row. Advances the sequence counter."""
        msg = Message(
            chat_session_id=session_id,
            chat_turn_id=turn_id,
            round_id=round_id,
            chat_agent_id=agent_id,
            sender_type=sender_type,
            message_type=message_type,
            visibility=visibility,
            content=content,
            sequence_no=self.next_seq,
        )
        self.db.add(msg)
        await self.db.flush()
        return msg

    async def _log_llm_call(
        self,
        turn_id: uuid.UUID,
        round_id: uuid.UUID,
        agent_id: uuid.UUID,
        provider: str,
        model: str,
        temperature: float,
    ) -> LLMCall:
        """Create an LLMCall record in 'started' state."""
        call_record = LLMCall(
            chat_turn_id=turn_id,
            round_id=round_id,
            chat_agent_id=agent_id,
            provider=provider,
            model=model,
            temperature=temperature,
            status=LLMCallStatus.running,
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(call_record)
        await self.db.flush()
        return call_record

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — LLM orchestration
    # ─────────────────────────────────────────────────────────────────────────

    async def _retrieve(self, ctx: TurnContext) -> list[RetrievedChunk]:
        """Call RetrievalService with the real DB session (session-wide, legacy)."""
        return await self._retrieval.retrieve(
            query=ctx.question,
            session_id=ctx.session_id,
            db=self.db,
        )

    async def _retrieve_for_agent(self, ctx: TurnContext, agent_ctx: AgentContext) -> list[RetrievedChunk]:
        """Agent-aware retrieval — respects agent's knowledge configuration."""
        return await self._retrieval.retrieve_for_agent(
            agent_id=agent_ctx.agent_id,
            session_id=ctx.session_id,
            query=ctx.question,
            db=self.db,
            knowledge_mode=agent_ctx.knowledge_mode,
            assigned_document_ids=agent_ctx.assigned_document_ids,
            top_k=RETRIEVAL_TOP_K,
        )

    async def _build_retrieval_summary(
        self,
        chunks: list[RetrievedChunk],
        max_chunks: int = RETRIEVAL_TOP_K,
        text_chars: int = 280,
    ) -> dict[str, Any] | None:
        """
        Build a UI-facing summary of retrieved chunks for the WS event payload.

        Groups chunks by document, looks up document filenames in one query,
        truncates chunk text. Stays runtime-only (not persisted).
        Returns None on any DB lookup failure to avoid blocking the debate.
        """
        if not chunks:
            return None

        from sqlalchemy import select  # local import to keep top-level minimal
        from app.models.document import Document

        # Cap to top N chunks (already ordered by similarity descending).
        capped = chunks[:max_chunks]

        # Resolve unique document IDs → filenames in one query.
        doc_ids = list({c.document_id for c in capped})
        names: dict[uuid.UUID, str] = {}
        try:
            rows = (
                await self.db.execute(
                    select(Document.id, Document.filename).where(Document.id.in_(doc_ids))
                )
            ).all()
            names = {row[0]: row[1] for row in rows}
        except Exception:  # pragma: no cover — defensive
            logger.warning("retrieval summary: failed to resolve document filenames", exc_info=True)

        # Group chunks by document, preserving overall ordering.
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
        agent_ctx: AgentContext,
        prompt: str,
        round_record: Round,
        turn_id: uuid.UUID,
        session_id: uuid.UUID,
        message_type: MessageType,
        retrieved_chunks: list[RetrievedChunk] | None = None,
    ) -> AgentRoundResult:
        """
        Call the LLM for one agent in one round.

        Steps:
          1. Record LLMCall start
          2. Call provider
          3. Attempt JSON parse of response
          4. Update LLMCall record (success/failed, tokens, latency)
          5. Save Message to DB
          6. Return AgentRoundResult

        Always saves a Message even on failure (content = error description).
        Never raises — failed agents are surfaced via AgentRoundResult.generation_status.
        """
        # ── Step gate (manual mode only) ─────────────────────────────────────
        # Emit agent_started so the UI can describe what is about to happen,
        # then wait on the step controller. In auto mode wait_for_step is a
        # no-op.
        step_meta = {
            "round_number": round_record.round_number,
            "agent_id": str(agent_ctx.agent_id),
            "agent_role": agent_ctx.role,
            "message_type": message_type.value,
        }
        logger.info(
            "WS emit agent_started: turn=%s round=%d agent=%s role=%s type=%s",
            turn_id,
            round_record.round_number,
            agent_ctx.agent_id,
            agent_ctx.role,
            message_type.value,
        )
        if self._on_event is not None:
            await self._on_event(ExecutionEvent(
                event_type=ExecutionEventType.agent_started,
                session_id=session_id,
                turn_id=turn_id,
                round_id=round_record.id,
                round_number=round_record.round_number,
                agent_id=agent_ctx.agent_id,
                payload=step_meta,
            ))
        if self._step_controller is not None:
            await self._step_controller.wait_for_step(turn_id, step_meta)

        call_record = await self._log_llm_call(
            turn_id=turn_id,
            round_id=round_record.id,
            agent_id=agent_ctx.agent_id,
            provider=agent_ctx.provider,
            model=agent_ctx.model,
            temperature=agent_ctx.temperature,
        )

        request = LLMRequest(
            provider=agent_ctx.provider,
            model=agent_ctx.model,
            prompt=prompt,
            temperature=agent_ctx.temperature,
            max_tokens=_resolve_max_tokens(round_record.round_number),
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
            content = response.content
            prompt_tokens = response.prompt_tokens
            completion_tokens = response.completion_tokens
            provider_latency_ms = response.latency_ms

            # Detect empty/whitespace-only responses (common with GPT-5 on
            # OpenRouter when reasoning_effort silently swallows the answer,
            # or when the provider returns a refusal in a non-content field).
            if not content or not content.strip():
                raise LLMError(
                    "Model returned an empty response. "
                    "Check model compatibility with current request parameters "
                    "(max_tokens, response_format)."
                )

            # Attempt JSON parse — fall back to raw text gracefully
            try:
                structured = parse_json_from_llm(content)
            except LLMParseError:
                logger.warning(
                    "Agent %s (%s): LLM response is not valid JSON — storing as plain text.",
                    agent_ctx.agent_id,
                    agent_ctx.role,
                )
                structured = {"raw_content": content}

            call_record.status = LLMCallStatus.completed
            call_record.prompt_tokens = prompt_tokens
            call_record.completion_tokens = completion_tokens
            call_record.latency_ms = provider_latency_ms

        except LLMError as exc:
            error_msg = str(exc)
            content = json.dumps({"error": error_msg})
            generation_status = "failed"
            call_record.status = LLMCallStatus.failed
            logger.exception(
                "LLM failure for agent %s (%s) in round %d: %s",
                agent_ctx.agent_id,
                agent_ctx.role,
                round_record.round_number,
                exc,
            )

        llm_finished_at = datetime.now(timezone.utc)
        measured_duration_ms = int((time.perf_counter() - llm_started_perf) * 1000)
        call_record.ended_at = llm_finished_at
        if call_record.latency_ms is None or call_record.latency_ms <= 0:
            call_record.latency_ms = measured_duration_ms

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

        await self.db.flush()

        # Save the message regardless of success/failure
        msg = await self._save_message(
            session_id=session_id,
            turn_id=turn_id,
            round_id=round_record.id,
            agent_id=agent_ctx.agent_id,
            sender_type=SenderType.agent,
            message_type=message_type,
            content=content,
        )

        if self._on_event is not None:
            event_payload: dict[str, Any] = {
                "message_id": str(msg.id),
                "round_id": str(round_record.id),
                "sender_type": msg.sender_type.value,
                "message_type": msg.message_type.value,
                "content": msg.content,
                "sequence_no": msg.sequence_no,
                "generation_status": generation_status,
            }
            if retrieved_chunks:
                retrieval_summary = await self._build_retrieval_summary(retrieved_chunks)
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
            await self._on_event(ExecutionEvent(
                event_type=ExecutionEventType.message_created,
                session_id=session_id,
                turn_id=turn_id,
                round_id=round_record.id,
                round_number=round_record.round_number,
                agent_id=agent_ctx.agent_id,
                payload=event_payload,
            ))

        return AgentRoundResult(
            agent_id=agent_ctx.agent_id,
            role=agent_ctx.role,
            content=content,
            structured=structured,
            generation_status=generation_status,
            error=error_msg,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────────

def _build_debate_summary(round2_results: list[AgentRoundResult]) -> str:
    """Render Round 2 results as a compact plain-text block for Round 3 prompts."""
    if not round2_results:
        return "No cross-examination occurred (single agent or Round 2 skipped)."

    lines: list[str] = []
    max_lines = 24
    for result in round2_results:
        critiques = result.structured.get("critiques", [])
        if not critiques:
            continue
        lines.append(f"{result.role} critiques:")
        for c in critiques[:2]:
            target = _clip_text(c.get("target_role", "?"), 36)
            challenge = _clip_text(c.get("challenge", ""), 180)
            weakness = _clip_text(c.get("weakness", ""), 120)
            lines.append(
                f"  - vs {target}: {challenge}"
                f" [weakness: {weakness}]"
            )
            if len(lines) >= max_lines:
                lines.append("Additional critiques omitted for brevity.")
                break

        if len(critiques) > 2:
            lines.append(f"  - (+{len(critiques) - 2} more critiques omitted)")

        if len(lines) >= max_lines:
            break

    return "\n".join(lines) if lines else "No substantive critiques were recorded."


def _clip_text(value: Any, max_chars: int) -> str:
    text = str(value or "").replace("\n", " ").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"
