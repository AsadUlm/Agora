/* ── Backend DTOs (aligned with server/app/schemas/debate.py) ──── */

export interface AgentDTO {
    id: string;
    role: string;
    provider: string;
    model: string;
    temperature: number | null;
    reasoning_style: string | null;
    position_order: number | null;
    knowledge_mode: string | null;
    knowledge_strict: boolean | null;
}

export interface MessageDTO {
    id: string;
    agent_id: string | null;
    agent_role: string | null;
    message_type: string; // agent_response | critique | final_summary
    sender_type: string; // agent | user | system
    payload: Record<string, unknown>;
    text: string;
    sequence_no: number;
    created_at: string;
}

export interface RoundDTO {
    id: string;
    round_number: number;
    round_type: string; // initial | critique | final
    status: string; // queued | running | completed | failed
    started_at: string | null;
    ended_at: string | null;
    messages: MessageDTO[];
}

export interface UserMessageDTO {
    content: string;
    created_at: string;
}

export interface TurnDTO {
    id: string;
    turn_index: number;
    status: string; // queued | running | completed | failed
    started_at: string | null;
    ended_at: string | null;
    user_message: UserMessageDTO | null;
    rounds: RoundDTO[];
    final_summary: Record<string, unknown> | null;
}

export interface SessionDetailDTO {
    id: string;
    title: string;
    question: string;
    status: string;
    created_at: string;
    updated_at: string;
    agents: AgentDTO[];
    latest_turn: TurnDTO | null;
}

export interface DebateStartRequest {
    question: string;
    agents: { role: string; config: Record<string, unknown>; document_ids?: string[] }[];
}

export interface DebateStartResponse {
    debate_id: string;
    turn_id: string;
    question: string;
    status: string;
    ws_session_url: string;
    ws_turn_url: string;
}

export interface DebateListItem {
    id: string;
    title: string;
    question: string;
    status: string;
    created_at: string;
}

/* ── WebSocket event shape ────────────────────────────────────── */

export type WsEventType =
    | "turn_started"
    | "round_started"
    | "agent_started"
    | "agent_completed"
    | "message_created"
    | "round_completed"
    | "turn_completed"
    | "turn_failed";

export interface WsEvent {
    type: WsEventType;
    session_id: string;
    turn_id: string;
    round_id: string | null;
    round_number: number | null;
    agent_id: string | null;
    payload: Record<string, unknown>;
    timestamp: string;
}

/* ── Document DTOs ────────────────────────────────────────────── */

export interface DocumentDTO {
    id: string;
    session_id: string;
    filename: string;
    source_type: string;
    status: string;
    created_at: string;
}
