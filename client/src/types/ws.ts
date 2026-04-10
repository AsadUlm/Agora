/* ------------------------------------------------------------------ */
/*  WebSocket event types — mirrors backend ws_payloads.py             */
/* ------------------------------------------------------------------ */

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

// ── Live debate state types ───────────────────────────────────────────

export interface LiveMessage {
    messageId: string;
    agentId: string;
    role: string;
    roundNumber: number;
    messageType: string;
    content: string; // raw JSON string from backend
    generationStatus: string;
}

export interface LiveRound {
    roundNumber: number;
    roundId: string | null;
    status: "running" | "completed";
    messages: LiveMessage[];
}

export type ConnectionStatus =
    | "idle"
    | "connecting"
    | "connected"
    | "disconnected"
    | "error";

export type DebatePhase = "idle" | "starting" | "live" | "completed" | "failed";

export interface DebateRuntime {
    debateId: string;
    turnId: string;
    question: string;
    agentMap: Record<string, string>; // agentId → role
    rounds: LiveRound[];
    connectionStatus: ConnectionStatus;
    error: string | null;
}
