// ── REST types ────────────────────────────────────────────────────────

export interface AgentInput {
    role: string;
    config?: Record<string, unknown>;
}

export interface DebateStartRequest {
    question: string;
    agents: AgentInput[];
}

export interface DebateStartResponse {
    debate_id: string;
    turn_id: string;
    question: string;
    status: string; // "queued"
    ws_session_url: string;
    ws_turn_url: string;
}

// ── WebSocket event types ─────────────────────────────────────────────

export type WsEventType =
    | "turn_started"
    | "round_started"
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

// ── Parsed message payload shapes ─────────────────────────────────────

export interface Round1Payload {
    stance: string;
    key_points: string[];
    confidence: number;
}

export interface Round2Payload {
    agreement: string;
    disagreements: string[];
    questions: string[];
    revised_stance: string;
}

export interface Round3Payload {
    final_stance: string;
    reasoning: string;
    recommendation: string;
}

// ── Local UI state ────────────────────────────────────────────────────

export interface LiveMessage {
    id: string;
    agentId: string | null;
    roundNumber: number;
    messageType: string;
    content: string;
    parsedPayload: Round1Payload | Round2Payload | Round3Payload | null;
    sequenceNo: number;
}

export type DebateStatus = "idle" | "queued" | "running" | "completed" | "failed";
