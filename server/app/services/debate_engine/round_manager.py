"""
Round Manager — executes a single round within a ChatTurn.

Responsibilities:
  1. Create the Round DB record and manage its lifecycle (queued → started → completed/failed)
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
    LLMRequest,
    RetrievedChunk,
    RoundContext,
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


class RoundManager:
    """
    Executes one round (1, 2, or 3) within a debate turn.

    Instantiated once per ChatTurn by the ChatEngine.
    The `seq` counter ensures messages are globally ordered within the turn.
    """

    def __init__(self, db: AsyncSession, seq_start: int = 0) -> None:
        self.db = db
        self._seq = seq_start                     # monotonic message sequence counter
        self._retrieval = RetrievalService()
        self._llm: LLMService = get_llm_service()

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
        chunks = await self._retrieve(ctx)
        results: list[AgentRoundResult] = []

        for agent_ctx in ctx.agents:
            prompt = build_opening_statement_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.agent_response,
            )
            results.append(result)

        await self._complete_round(round_record)
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
        chunks = await self._retrieve(ctx)
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
                await self._save_message(
                    session_id=ctx.session_id,
                    turn_id=ctx.turn_id,
                    round_id=round_record.id,
                    agent_id=agent_ctx.agent_id,
                    sender_type=SenderType.agent,
                    message_type=MessageType.critique,
                    content=empty_result.content,
                )
                results.append(empty_result)
                continue

            prompt = build_critique_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                own_stance=own_stance,
                other_agents=other_agents,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.critique,
            )
            results.append(result)

        await self._complete_round(round_record)
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
        chunks = await self._retrieve(ctx)
        results: list[AgentRoundResult] = []

        r1_by_id: dict[str, AgentRoundResult] = {
            str(r.agent_id): r for r in round1_results
        }

        # Build the debate summary from Round 2 results for the prompt
        debate_summary = _build_debate_summary(round2_results)

        for agent_ctx in ctx.agents:
            own_r1 = r1_by_id.get(str(agent_ctx.agent_id))
            original_stance = own_r1.structured.get("stance", "") if own_r1 else ""

            prompt = build_final_synthesis_prompt(
                role=agent_ctx.role,
                question=ctx.question,
                original_stance=original_stance,
                debate_summary=debate_summary,
                reasoning_style=agent_ctx.reasoning_style,
                reasoning_depth=agent_ctx.reasoning_depth,
            )
            result = await self._call_llm(
                agent_ctx=agent_ctx,
                prompt=prompt,
                round_record=round_record,
                turn_id=ctx.turn_id,
                session_id=ctx.session_id,
                message_type=MessageType.final_summary,
            )
            results.append(result)

        await self._complete_round(round_record)
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
        """Create a Round record, mark it started, flush to DB."""
        round_record = Round(
            chat_turn_id=ctx.turn_id,
            round_number=round_number,
            round_type=round_type,
            status=RoundStatus.started,
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(round_record)
        await self.db.flush()
        logger.info(
            "Round %d started (id=%s, turn=%s)",
            round_number,
            round_record.id,
            ctx.turn_id,
        )
        return round_record

    async def _complete_round(self, round_record: Round) -> None:
        """Mark a round completed with timestamp."""
        round_record.status = RoundStatus.completed
        round_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()
        logger.info("Round %d completed.", round_record.round_number)

    async def _fail_round(self, round_record: Round, reason: str) -> None:
        """Mark a round failed."""
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
            status=LLMCallStatus.started,
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(call_record)
        await self.db.flush()
        return call_record

    # ─────────────────────────────────────────────────────────────────────────
    # Internal helpers — LLM orchestration
    # ─────────────────────────────────────────────────────────────────────────

    async def _retrieve(self, ctx: TurnContext) -> list[RetrievedChunk]:
        """Call RetrievalService. Step 5 will return real chunks."""
        return await self._retrieval.retrieve(
            query=ctx.question,
            session_id=ctx.session_id,
        )

    async def _call_llm(
        self,
        agent_ctx: AgentContext,
        prompt: str,
        round_record: Round,
        turn_id: uuid.UUID,
        session_id: uuid.UUID,
        message_type: MessageType,
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
        )

        content = ""
        structured: dict[str, Any] = {}
        generation_status = "success"
        error_msg: str | None = None

        try:
            response = await self._llm.generate(request)
            content = response.content

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

            call_record.status = LLMCallStatus.success
            call_record.prompt_tokens = response.prompt_tokens
            call_record.completion_tokens = response.completion_tokens
            call_record.latency_ms = response.latency_ms

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

        call_record.ended_at = datetime.now(timezone.utc)
        await self.db.flush()

        # Save the message regardless of success/failure
        await self._save_message(
            session_id=session_id,
            turn_id=turn_id,
            round_id=round_record.id,
            agent_id=agent_ctx.agent_id,
            sender_type=SenderType.agent,
            message_type=message_type,
            content=content,
        )

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
    """Render Round 2 results as a readable plain-text block for Round 3 prompts."""
    if not round2_results:
        return "No cross-examination occurred (single agent or Round 2 skipped)."

    lines: list[str] = []
    for result in round2_results:
        critiques = result.structured.get("critiques", [])
        if not critiques:
            continue
        lines.append(f"{result.role} critique:")
        for c in critiques:
            lines.append(
                f"  → vs {c.get('target_role', '?')}: {c.get('challenge', '')} "
                f"[weakness: {c.get('weakness', '')}]"
            )

    return "\n".join(lines) if lines else "No substantive critiques were recorded."
