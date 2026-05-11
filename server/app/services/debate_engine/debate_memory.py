"""Debate memory builder.

Aggregates the cumulative state of an ongoing debate (initial 3 rounds + any
prior follow-up cycles) so a new follow-up cycle can be executed without
restarting the conversation.

Step 24 changes:
  - Replaces raw ``agent_states`` exposure with a structured ``debate_summary``
    (consensus, main_conflict, strongest_arguments per agent, unresolved_questions).
  - Adds ``cycle_memories`` — per-cycle compact summaries persisted on
    ``DebateFollowUp.cycle_summary``. Used as the primary context for cycle N+1
    instead of replaying the full message history.
  - ``agent_states`` is still exposed (for backward compatibility) but the
    prompts now prefer the structured summary.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn
from app.models.debate_follow_up import DebateFollowUp
from app.models.message import MessageType, SenderType
from app.models.round import Round, RoundType

logger = logging.getLogger(__name__)


@dataclass
class AgentMemoryState:
    agent_id: uuid.UUID
    role: str
    latest_position: str = ""
    key_arguments: list[str] = field(default_factory=list)


@dataclass
class AgentStrongestArgument:
    agent_id: uuid.UUID
    role: str
    argument: str


@dataclass
class DebateSummary:
    """Structured high-level snapshot used by follow-up prompts."""

    consensus: str = ""
    main_conflict: str = ""
    strongest_arguments: list[AgentStrongestArgument] = field(default_factory=list)
    unresolved_questions: list[str] = field(default_factory=list)


@dataclass
class CycleMemory:
    """Compact memory snapshot for one completed follow-up cycle."""

    cycle_number: int
    question: str
    summary: str


@dataclass
class FollowUpHistoryItem:
    cycle_number: int
    question: str
    updated_conclusion: str = ""


@dataclass
class DebateMemory:
    original_question: str
    previous_synthesis: str
    debate_summary: DebateSummary
    agent_states: list[AgentMemoryState]
    disagreements: list[str]
    cycle_memories: list[CycleMemory]
    followups_history: list[FollowUpHistoryItem]

    def to_dict(self) -> dict[str, Any]:
        return {
            "original_question": self.original_question,
            "previous_synthesis": self.previous_synthesis,
            "debate_summary": {
                "consensus": self.debate_summary.consensus,
                "main_conflict": self.debate_summary.main_conflict,
                "strongest_arguments": [
                    {
                        "agent_id": str(a.agent_id),
                        "role": a.role,
                        "argument": a.argument,
                    }
                    for a in self.debate_summary.strongest_arguments
                ],
                "unresolved_questions": self.debate_summary.unresolved_questions,
            },
            "agent_states": [
                {
                    "agent_id": str(s.agent_id),
                    "role": s.role,
                    "latest_position": s.latest_position,
                    "key_arguments": s.key_arguments,
                }
                for s in self.agent_states
            ],
            "disagreements": self.disagreements,
            "cycle_memories": [
                {
                    "cycle_number": c.cycle_number,
                    "question": c.question,
                    "summary": c.summary,
                }
                for c in self.cycle_memories
            ],
            "followups_history": [
                {
                    "cycle_number": h.cycle_number,
                    "question": h.question,
                    "updated_conclusion": h.updated_conclusion,
                }
                for h in self.followups_history
            ],
        }


def _safe_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _pick(d: dict[str, Any], *keys: str, default: str = "") -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return default


def _short(text: str, max_chars: int) -> str:
    norm = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(norm) <= max_chars:
        return norm
    return norm[: max_chars - 1].rstrip() + "…"


def _derive_debate_summary(
    rounds: list[Round],
    agents: list[ChatAgent],
    agent_states: dict[uuid.UUID, AgentMemoryState],
) -> DebateSummary:
    """Derive a structured summary from the latest synthesis + per-agent state."""
    synthesis_types = {RoundType.final, RoundType.updated_synthesis}
    consensus = ""
    main_conflict = ""
    unresolved: list[str] = []

    latest_synth_payload: dict[str, Any] = {}
    for r in reversed(rounds):
        if r.round_type in synthesis_types and r.messages:
            for msg in sorted(r.messages, key=lambda m: m.sequence_no, reverse=True):
                payload = _safe_json(msg.content)
                if payload:
                    latest_synth_payload = payload
                    break
            if latest_synth_payload:
                break

    if latest_synth_payload:
        consensus = _pick(
            latest_synth_payload,
            "consensus",
            "agreement",
            "shared_ground",
            "updated_conclusion",
            "conclusion",
            "final_position",
        )
        main_conflict = _pick(
            latest_synth_payload,
            "main_conflict",
            "core_disagreement",
            "key_tension",
            "remaining_disagreement",
            "remaining_concerns",
        )
        for key in ("unresolved_questions", "open_questions", "remaining_concerns"):
            v = latest_synth_payload.get(key)
            if isinstance(v, list):
                unresolved.extend(
                    _short(str(item), 200) for item in v if str(item or "").strip()
                )
            elif isinstance(v, str) and v.strip():
                unresolved.append(_short(v, 200))
            if unresolved:
                break

    strongest: list[AgentStrongestArgument] = []
    for a in agents:
        st = agent_states.get(a.id)
        if st is None:
            continue
        arg = ""
        if st.key_arguments:
            arg = _short(st.key_arguments[0], 240)
        if not arg and st.latest_position:
            arg = _short(st.latest_position, 240)
        if arg:
            strongest.append(
                AgentStrongestArgument(agent_id=a.id, role=a.role, argument=arg)
            )

    return DebateSummary(
        consensus=_short(consensus, 360),
        main_conflict=_short(main_conflict, 360),
        strongest_arguments=strongest,
        unresolved_questions=unresolved[:5],
    )


def _compact_cycle_summary(
    cycle_number: int,
    question: str,
    updated_synth_payload: dict[str, Any],
) -> str:
    """Build a compact one-paragraph summary of a finished follow-up cycle."""
    conclusion = _pick(
        updated_synth_payload,
        "updated_conclusion",
        "conclusion",
        "final_position",
    )
    changed = _pick(updated_synth_payload, "conclusion_changed")
    why = _pick(updated_synth_payload, "change_reason", "what_changed")
    strongest = _pick(updated_synth_payload, "strongest_argument")
    remaining = _pick(
        updated_synth_payload,
        "remaining_disagreement",
        "remaining_concerns",
        "open_questions",
    )

    parts: list[str] = [f"Cycle {cycle_number} — Q: {_short(question, 160)}"]
    if conclusion:
        parts.append(f"Conclusion: {_short(conclusion, 240)}")
    if changed:
        if why:
            parts.append(f"Conclusion changed: {changed.lower()} — {_short(why, 200)}")
        else:
            parts.append(f"Conclusion changed: {changed.lower()}")
    elif why:
        parts.append(f"What changed: {_short(why, 200)}")
    if strongest:
        parts.append(f"Strongest argument: {_short(strongest, 200)}")
    if remaining:
        parts.append(f"Open: {_short(remaining, 200)}")
    return " | ".join(parts)


async def build_debate_memory(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> DebateMemory:
    """Reconstruct the cumulative state of an ongoing debate."""
    session_row = await db.execute(
        select(ChatSession)
        .where(ChatSession.id == session_id)
        .options(
            selectinload(ChatSession.chat_agents),
            selectinload(ChatSession.chat_turns)
            .selectinload(ChatTurn.rounds)
            .selectinload(Round.messages),
            selectinload(ChatSession.chat_turns).selectinload(ChatTurn.messages),
        )
    )
    session = session_row.scalar_one_or_none()
    if session is None:
        raise ValueError(f"ChatSession {session_id} not found.")

    turns = sorted(session.chat_turns, key=lambda t: t.turn_index)
    if not turns:
        return DebateMemory(
            original_question="",
            previous_synthesis="",
            debate_summary=DebateSummary(),
            agent_states=[],
            disagreements=[],
            cycle_memories=[],
            followups_history=[],
        )

    turn = turns[-1]

    original_question = ""
    for m in turn.messages:
        if m.message_type == MessageType.user_input and m.sender_type == SenderType.user:
            original_question = m.content
            break

    rounds = sorted(turn.rounds, key=lambda r: r.round_number)

    synthesis_types = {RoundType.final, RoundType.updated_synthesis}
    previous_synthesis_text = ""
    for r in reversed(rounds):
        if r.round_type in synthesis_types and r.messages:
            best = ""
            for msg in sorted(r.messages, key=lambda m: m.sequence_no):
                payload = _safe_json(msg.content)
                txt = _pick(
                    payload,
                    "updated_conclusion",
                    "conclusion",
                    "final_position",
                    "response",
                    "display_content",
                )
                if txt and len(txt) > len(best):
                    best = txt
            previous_synthesis_text = best
            break

    agents_by_id: dict[uuid.UUID, ChatAgent] = {a.id: a for a in session.chat_agents}
    agent_states: dict[uuid.UUID, AgentMemoryState] = {
        a.id: AgentMemoryState(agent_id=a.id, role=a.role)
        for a in session.chat_agents
    }

    opinion_types = {
        RoundType.initial,
        RoundType.followup_response,
        RoundType.final,
        RoundType.updated_synthesis,
    }
    for r in rounds:
        if r.round_type not in opinion_types:
            continue
        for msg in r.messages:
            if msg.chat_agent_id is None or msg.sender_type != SenderType.agent:
                continue
            state = agent_states.get(msg.chat_agent_id)
            if state is None:
                continue
            payload = _safe_json(msg.content)
            position = _pick(
                payload,
                "answer_to_followup",
                "final_position",
                "main_argument",
                "stance",
                "response",
                "display_content",
            )
            if position:
                state.latest_position = position
            kp = payload.get("key_points")
            if isinstance(kp, list):
                cleaned = [str(x).strip() for x in kp if str(x or "").strip()]
                if cleaned:
                    state.key_arguments = cleaned[:5]

    critique_types = {RoundType.critique, RoundType.followup_critique}
    disagreements: list[str] = []
    for r in reversed(rounds):
        if r.round_type in critique_types and r.messages:
            for msg in sorted(r.messages, key=lambda m: m.sequence_no):
                payload = _safe_json(msg.content)
                target = _pick(payload, "target_agent")
                challenge = _pick(payload, "challenge", "weakness_found")
                if challenge:
                    line = f"{target}: {challenge}" if target else challenge
                    disagreements.append(line[:300])
            break

    debate_summary = _derive_debate_summary(rounds, session.chat_agents, agent_states)
    if not debate_summary.unresolved_questions and disagreements:
        debate_summary.unresolved_questions = [
            _short(d, 200) for d in disagreements[:3]
        ]

    fu_rows = await db.execute(
        select(DebateFollowUp)
        .where(DebateFollowUp.chat_turn_id == turn.id)
        .order_by(DebateFollowUp.cycle_number.asc())
    )
    history: list[FollowUpHistoryItem] = []
    cycle_memories: list[CycleMemory] = []
    for fu in fu_rows.scalars().all():
        conclusion = ""
        synth_payload: dict[str, Any] = {}
        for r in rounds:
            if (
                r.cycle_number == fu.cycle_number
                and r.round_type == RoundType.updated_synthesis
            ):
                for msg in sorted(r.messages, key=lambda m: m.sequence_no):
                    payload = _safe_json(msg.content)
                    if payload:
                        synth_payload = payload
                        txt = _pick(payload, "updated_conclusion", "short_summary")
                        if txt:
                            conclusion = txt
                            break
                break

        history.append(
            FollowUpHistoryItem(
                cycle_number=fu.cycle_number,
                question=fu.question,
                updated_conclusion=conclusion,
            )
        )

        summary_text = (fu.cycle_summary or "").strip()
        if not summary_text and synth_payload:
            summary_text = _compact_cycle_summary(
                fu.cycle_number, fu.question, synth_payload
            )
        if summary_text:
            cycle_memories.append(
                CycleMemory(
                    cycle_number=fu.cycle_number,
                    question=fu.question,
                    summary=summary_text,
                )
            )

    return DebateMemory(
        original_question=original_question,
        previous_synthesis=previous_synthesis_text,
        debate_summary=debate_summary,
        agent_states=list(agent_states.values()),
        disagreements=disagreements[:10],
        cycle_memories=cycle_memories,
        followups_history=history,
    )


def latest_cycle_number(rounds: list[Round]) -> int:
    """Largest cycle_number among given rounds (defaults to 1)."""
    if not rounds:
        return 1
    return max((r.cycle_number or 1) for r in rounds)


def build_compact_cycle_summary(
    cycle_number: int,
    question: str,
    updated_synth_payload: dict[str, Any],
) -> str:
    """Public re-export of the cycle summary builder for the followup runner."""
    return _compact_cycle_summary(cycle_number, question, updated_synth_payload)
