"""
Serializer layer — Step 6 DTO shaping.

Converts ORM objects into structured, frontend-ready dicts that map 1-to-1
with the output schemas (DTOs) in `app.schemas.debate`.

Design principles:
- Functions are pure: take ORM objects, return plain dicts (no DB calls inside)
- Agent info is denormalized into MessageDTO so the frontend never needs to
  cross-reference IDs
- final_summary is promoted from round messages to the turn level so the
  frontend can render it without scanning all rounds
- All datetimes serialized via Pydantic model_dump(mode="json") on the callers;
  here we keep them as Python objects so Pydantic validates and serializes them
- No exceptions raised — missing data degrades gracefully to None / {}
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.models.chat_agent import ChatAgent
from app.models.chat_session import ChatSession
from app.models.chat_turn import ChatTurn
from app.models.message import Message, MessageType, SenderType
from app.models.round import Round
from app.schemas.debate import (
    AgentDTO,
    MessageDTO,
    RoundDTO,
    SessionDetailDTO,
    TurnDTO,
    UserMessageDTO,
    DebateTrace,
    CritiqueTraceItem,
    CritiqueResponseTraceItem,
    RevisedPositionTraceItem,
    DebateImpact,
    ImportantChange,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_payload(content: str) -> dict[str, Any]:
    """
    Try to parse message content as JSON.

    Returns:
        Parsed dict if the content is valid JSON.
        {"text": content} as a safe fallback for plain-text LLM output.
    """
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
        return {"value": parsed}
    except (json.JSONDecodeError, TypeError):
        return {"text": content}


def _agents_index(agents: list[ChatAgent]) -> dict[uuid.UUID, ChatAgent]:
    """Build a UUID→ChatAgent lookup used for denormalizing agent info into messages."""
    return {a.id: a for a in agents}


# ── Core serializers ──────────────────────────────────────────────────────────

def serialize_agent(agent: ChatAgent) -> AgentDTO:
    """Serialize a ChatAgent ORM object to AgentOut."""
    return AgentDTO(
        id=agent.id,
        role=agent.role,
        provider=agent.provider,
        model=agent.model,
        temperature=agent.temperature,
        reasoning_style=agent.reasoning_style,
        position_order=agent.position_order,
    )


def serialize_message(
    msg: Message,
    agents_by_id: dict[uuid.UUID, ChatAgent],
) -> MessageDTO:
    """
    Serialize a Message ORM object to MessageOut.

    Agent role is denormalized from the agents_by_id lookup so the frontend
    does not need a separate agent table lookup to display author info.
    """
    agent = agents_by_id.get(msg.chat_agent_id) if msg.chat_agent_id else None
    return MessageDTO(
        id=msg.id,
        agent_id=msg.chat_agent_id,
        agent_role=agent.role if agent else None,
        message_type=msg.message_type.value,
        sender_type=msg.sender_type.value,
        payload=_parse_payload(msg.content),
        text=msg.content,
        sequence_no=msg.sequence_no,
        created_at=msg.created_at,
    )


def serialize_round(
    round_obj: Round,
    agents_by_id: dict[uuid.UUID, ChatAgent],
) -> RoundDTO:
    """
    Serialize a Round ORM object to RoundOut.

    Only agent messages are included (user/system messages live at the turn
    level and are not duplicated here).  Messages are ordered by sequence_no.
    """
    agent_messages = sorted(
        [m for m in round_obj.messages if m.sender_type == SenderType.agent],
        key=lambda m: m.sequence_no,
    )
    return RoundDTO(
        id=round_obj.id,
        round_number=round_obj.round_number,
        cycle_number=round_obj.cycle_number,
        round_type=round_obj.round_type.value,
        status=round_obj.status.value,
        started_at=round_obj.started_at,
        ended_at=round_obj.ended_at,
        messages=[serialize_message(m, agents_by_id) for m in agent_messages],
    )


def _build_debate_trace(
    turn: ChatTurn,
    agents_by_id: dict[uuid.UUID, ChatAgent],
) -> DebateTrace | None:
    """
    Derive a structured DebateTrace from the round messages.

    Extracts critique→response→revised traceability links. Safe to call on
    old 3-round debates (returns None if the new round types are absent).
    """
    # Build lookup maps from rounds
    critique_round: Round | None = None
    critique_response_round: Round | None = None
    revised_position_round: Round | None = None

    from app.models.round import RoundType
    for r in (turn.rounds or []):
        if r.round_type == RoundType.critique and r.cycle_number == 1:
            critique_round = r
        elif r.round_type == RoundType.critique_response:
            critique_response_round = r
        elif r.round_type == RoundType.revised_position:
            revised_position_round = r

    # If no new-style rounds exist, return None (old debate)
    if critique_response_round is None and revised_position_round is None:
        return None

    # Build agent lookup by role
    agent_by_role: dict[str, ChatAgent] = {}
    for agent in agents_by_id.values():
        agent_by_role[agent.role] = agent

    # ── Critique items ────────────────────────────────────────────────────────
    critiques: list[CritiqueTraceItem] = []
    if critique_round:
        for msg in critique_round.messages:
            if msg.sender_type != SenderType.agent:
                continue
            payload = _parse_payload(msg.content)
            from_agent = agents_by_id.get(msg.chat_agent_id)
            target_role = (payload.get("target_agent") or "").strip()
            to_agent = agent_by_role.get(target_role)
            if not from_agent:
                continue
            critiques.append(CritiqueTraceItem(
                id=str(msg.id),
                from_agent_id=str(from_agent.id),
                from_agent_name=from_agent.role,
                to_agent_id=str(to_agent.id) if to_agent else target_role,
                to_agent_name=target_role or "Unknown",
                target_claim=str(payload.get("challenge") or payload.get("target_claim") or ""),
                critique_summary=str(payload.get("short_summary") or payload.get("one_sentence_takeaway") or ""),
                weakness_found=str(payload.get("weakness_found") or ""),
            ))

    # ── Critique response items ───────────────────────────────────────────────
    critique_responses: list[CritiqueResponseTraceItem] = []
    if critique_response_round:
        for msg in critique_response_round.messages:
            if msg.sender_type != SenderType.agent:
                continue
            payload = _parse_payload(msg.content)
            agent = agents_by_id.get(msg.chat_agent_id)
            if not agent:
                continue
            accepted = payload.get("accepted_points") or []
            rejected = payload.get("rejected_points") or []
            if not isinstance(accepted, list):
                accepted = [str(accepted)] if accepted else []
            if not isinstance(rejected, list):
                rejected = [str(rejected)] if rejected else []
            critique_responses.append(CritiqueResponseTraceItem(
                id=str(msg.id),
                agent_id=str(agent.id),
                agent_name=agent.role,
                received_critique_summary=str(payload.get("received_critique_summary") or ""),
                response=str(payload.get("response") or ""),
                accepted_points=[str(p) for p in accepted if p],
                rejected_points=[str(p) for p in rejected if p],
                planned_revision=str(payload.get("planned_revision") or ""),
                stance_update=str(payload.get("stance_update") or "unchanged"),
            ))

    # ── Revised position items ────────────────────────────────────────────────
    revised_positions: list[RevisedPositionTraceItem] = []
    if revised_position_round:
        for msg in revised_position_round.messages:
            if msg.sender_type != SenderType.agent:
                continue
            payload = _parse_payload(msg.content)
            agent = agents_by_id.get(msg.chat_agent_id)
            if not agent:
                continue
            key_claims = payload.get("key_claims") or []
            if not isinstance(key_claims, list):
                key_claims = []
            revised_positions.append(RevisedPositionTraceItem(
                id=str(msg.id),
                agent_id=str(agent.id),
                agent_name=agent.role,
                initial_position_summary=str(payload.get("initial_position_summary") or ""),
                revised_position=str(payload.get("revised_position") or payload.get("response") or ""),
                change_summary=str(payload.get("change_summary") or ""),
                changed=bool(payload.get("changed", False)),
                change_type=str(payload.get("change_type") or ""),
                reason_for_change=str(payload.get("reason_for_change") or ""),
                key_claims=[str(c) for c in key_claims if c],
            ))

    # ── Debate impact ─────────────────────────────────────────────────────────
    important_changes: list[ImportantChange] = []
    initial_positions_by_agent: dict[str, str] = {}

    # Get initial positions from round 1
    for r in (turn.rounds or []):
        if r.round_type and r.round_type.value == "initial":
            for msg in r.messages:
                if msg.sender_type == SenderType.agent:
                    payload = _parse_payload(msg.content)
                    a = agents_by_id.get(msg.chat_agent_id)
                    if a:
                        initial_positions_by_agent[str(a.id)] = str(
                            payload.get("main_argument") or payload.get("short_summary") or payload.get("stance") or ""
                        )

    for rp in revised_positions:
        if rp.changed:
            initial = initial_positions_by_agent.get(rp.agent_id, rp.initial_position_summary)
            important_changes.append(ImportantChange(
                agent_id=rp.agent_id,
                agent_name=rp.agent_name,
                before=initial or rp.initial_position_summary,
                after=rp.revised_position,
                why_changed=rp.reason_for_change,
            ))

    major_disagreements: list[str] = []
    for c in critiques:
        if c.target_claim:
            major_disagreements.append(f"{c.from_agent_name} challenged {c.to_agent_name}: {c.target_claim[:120]}")

    debate_impact = DebateImpact(
        initial_consensus="" ,
        major_disagreements=major_disagreements[:5],
        important_changes=important_changes,
        how_debate_improved_answer=(
            f"{len(important_changes)} agent(s) revised their position after debate."
            if important_changes else
            "Agents maintained their positions; debate reinforced existing views."
        ),
        single_llm_risk_avoided=(
            "Multiple agents with different frameworks challenged each other's assumptions, "
            "reducing single-perspective bias."
        ),
    )

    return DebateTrace(
        critiques=critiques,
        critique_responses=critique_responses,
        revised_positions=revised_positions,
        debate_impact=debate_impact,
    )


def serialize_turn(
    turn: ChatTurn,
    agents_by_id: dict[uuid.UUID, ChatAgent],
) -> TurnDTO:
    """
    Serialize a ChatTurn ORM object to TurnOut.

    Promotes `final_summary` from round 5 (or last round) messages to the turn level so the
    frontend can access it directly without scanning nested rounds.
    """
    # User question — first user_input message in the turn
    user_msg_orm = next(
        (m for m in turn.messages if m.message_type == MessageType.user_input),
        None,
    )
    user_message = (
        UserMessageDTO(
            content=user_msg_orm.content,
            created_at=user_msg_orm.created_at,
        )
        if user_msg_orm
        else None
    )

    # Rounds sorted ascending
    rounds = [
        serialize_round(r, agents_by_id)
        for r in sorted(turn.rounds, key=lambda r: r.round_number)
    ]

    # Final summary: look for final_summary type message in any round (usually round 3)
    final_summary: dict[str, Any] | None = None
    for r in sorted(turn.rounds, key=lambda r: r.round_number, reverse=True):
        for msg in r.messages:
            if msg.message_type == MessageType.final_summary:
                final_summary = _parse_payload(msg.content)
                break
        if final_summary is not None:
            break

    # Compute debate trace (new 5-stage pipeline only — None for legacy 3-round debates)
    try:
        debate_trace = _build_debate_trace(turn, agents_by_id)
    except Exception:
        debate_trace = None

    # Detect 5-stage pipeline: True if current_round_no > 3 or if new round types are present.
    # This flag is set even during generation (before critique_response rounds are created)
    # so the frontend can show the 5-stage timeline immediately.
    from app.models.round import RoundType as _RT
    _new_round_types = {_RT.critique_response, _RT.revised_position}
    is_5stage_pipeline = (
        (turn.current_round_no or 0) > 3
        or any(
            r.round_type in _new_round_types
            for r in (turn.rounds or [])
        )
    )

    return TurnDTO(
        id=turn.id,
        turn_index=turn.turn_index,
        status=turn.status.value,
        current_stage=turn.current_round_no,
        synthesis_status=turn.synthesis_status,
        request_id=turn.request_id,
        error=turn.error_metadata,
        started_at=turn.started_at,
        ended_at=turn.ended_at,
        user_message=user_message,
        rounds=rounds,
        final_summary=final_summary,
        debate_trace=debate_trace,
        is_5stage_pipeline=is_5stage_pipeline,
    )


def serialize_session(session: ChatSession) -> SessionDetailDTO:
    """
    Serialize a ChatSession ORM object (with relationships loaded) to SessionDetailOut.

    Requires the following relationships to be eagerly loaded:
        - chat_agents
        - chat_turns → rounds → messages
        - chat_turns → messages
    """
    agents_by_id = _agents_index(session.chat_agents)

    agents_out = [
        serialize_agent(a)
        for a in sorted(
            session.chat_agents,
            key=lambda a: (a.position_order or 0, str(a.id)),
        )
    ]

    turns = sorted(session.chat_turns, key=lambda t: t.turn_index)
    latest_turn = turns[-1] if turns else None
    latest_turn_out = serialize_turn(latest_turn, agents_by_id) if latest_turn else None

    # Derive question: prefer user_message content, fall back to session title
    question = ""
    if latest_turn_out and latest_turn_out.user_message:
        question = latest_turn_out.user_message.content
    elif session.title:
        question = session.title

    # Session-level status = latest turn status
    status = latest_turn.status.value if latest_turn else "unknown"

    return SessionDetailDTO(
        id=session.id,
        title=session.title or "",
        question=question,
        status=status,
        created_at=session.created_at,
        updated_at=session.updated_at,
        agents=agents_out,
        latest_turn=latest_turn_out,
    )
