/* ------------------------------------------------------------------ */
/*  Debate domain types — mirrors backend response shapes              */
/* ------------------------------------------------------------------ */

/** Per-agent, per-round generation outcome. */
export type GenerationStatus = "success" | "failed" | "skipped";

/** The three structural round types in every debate. */
export type RoundType = "initial" | "critique" | "final";

/** Overall debate turn lifecycle status. */
export type DebateStatus = "queued" | "running" | "completed" | "failed" | "unknown";

// ── Structured JSON shapes returned inside AgentRoundResult.structured ─

export interface Round1Structured {
    stance: string;
    key_points: string[];
    confidence: number;
}

export interface CritiqueEntry {
    target_role: string;
    challenge: string;
    weakness: string;
    counter_evidence?: string;
}

export interface Round2Structured {
    critiques: CritiqueEntry[];
}

export interface Round3Structured {
    final_stance: string;
    what_changed: string;
    remaining_concerns: string;
    recommendation: string;
}

// ── API response: POST /debates/start ────────────────────────────────

/** One agent's output in a single round (used in GET /debates/{id} round data). */
export interface AgentRoundResult {
    agent_id: string;
    role: string;
    content: string;
    structured: Record<string, unknown>;
    generation_status: GenerationStatus;
    error: string | null;
}

/** Full response from POST /debates/start — async model, returns immediately. */
export interface DebateStartResponse {
    debate_id: string;
    turn_id: string;
    question: string;
    status: DebateStatus; // always "queued"
    ws_session_url: string;
    ws_turn_url: string;
}

// ── API response: GET /debates/{id} ──────────────────────────────────

export interface DebateAgent {
    id: string;
    role: string;
    config: Record<string, unknown>;
}

export interface RoundDataEntry {
    agent_id: string;
    message_type: string;
    data: Record<string, unknown>;
}

export interface DebateRound {
    id: string;
    round_number: number;
    round_type: RoundType;
    status: string;
    data: RoundDataEntry[];
}

export interface DebateDetail {
    id: string;
    question: string;
    status: DebateStatus;
    created_at: string;
    agents: DebateAgent[];
    rounds: DebateRound[];
}

// ── API response: GET /debates ────────────────────────────────────────

export interface DebateListItem {
    id: string;
    title: string;
    status: DebateStatus;
    created_at: string;
}

// ── Request types ─────────────────────────────────────────────────────

export interface AgentCreateRequest {
    role: string;
    config: Record<string, unknown>;
}

export interface DebateStartRequest {
    question: string;
    agents: AgentCreateRequest[];
}
