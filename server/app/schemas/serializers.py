"""
Serializer layer — Step 6 DTO shaping.

Converts ORM objects into structured, frontend-ready dicts that map 1-to-1
with the output schemas in `app.schemas.debate`.

Design principles:
- Functions are pure: take ORM objects, return plain dicts (no DB calls inside)
- Agent info is denormalized into MessageOut so the frontend never needs to
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
    AgentOut,
    MessageOut,
    RoundOut,
    SessionDetailOut,
    TurnOut,
    UserMessageOut,
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

def serialize_agent(agent: ChatAgent) -> AgentOut:
    """Serialize a ChatAgent ORM object to AgentOut."""
    return AgentOut(
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
) -> MessageOut:
    """
    Serialize a Message ORM object to MessageOut.

    Agent role is denormalized from the agents_by_id lookup so the frontend
    does not need a separate agent table lookup to display author info.
    """
    agent = agents_by_id.get(msg.chat_agent_id) if msg.chat_agent_id else None
    return MessageOut(
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
) -> RoundOut:
    """
    Serialize a Round ORM object to RoundOut.

    Only agent messages are included (user/system messages live at the turn
    level and are not duplicated here).  Messages are ordered by sequence_no.
    """
    agent_messages = sorted(
        [m for m in round_obj.messages if m.sender_type == SenderType.agent],
        key=lambda m: m.sequence_no,
    )
    return RoundOut(
        id=round_obj.id,
        round_number=round_obj.round_number,
        round_type=round_obj.round_type.value,
        status=round_obj.status.value,
        started_at=round_obj.started_at,
        ended_at=round_obj.ended_at,
        messages=[serialize_message(m, agents_by_id) for m in agent_messages],
    )


def serialize_turn(
    turn: ChatTurn,
    agents_by_id: dict[uuid.UUID, ChatAgent],
) -> TurnOut:
    """
    Serialize a ChatTurn ORM object to TurnOut.

    Promotes `final_summary` from round 3 messages to the turn level so the
    frontend can access it directly without scanning nested rounds.
    """
    # User question — first user_input message in the turn
    user_msg_orm = next(
        (m for m in turn.messages if m.message_type == MessageType.user_input),
        None,
    )
    user_message = (
        UserMessageOut(
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

    return TurnOut(
        id=turn.id,
        turn_index=turn.turn_index,
        status=turn.status.value,
        started_at=turn.started_at,
        ended_at=turn.ended_at,
        user_message=user_message,
        rounds=rounds,
        final_summary=final_summary,
    )


def serialize_session(session: ChatSession) -> SessionDetailOut:
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

    return SessionDetailOut(
        id=session.id,
        title=session.title or "",
        question=question,
        status=status,
        created_at=session.created_at,
        updated_at=session.updated_at,
        agents=agents_out,
        latest_turn=latest_turn_out,
    )
