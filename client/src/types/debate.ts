/* ------------------------------------------------------------------ */
/*  Domain types for the Agora debate platform                        */
/* ------------------------------------------------------------------ */

// ── Request types ────────────────────────────────────────────────────

export interface AgentInput {
    role: string;
    config?: Record<string, unknown>;
}

export interface StartDebateRequest {
    question: string;
    agents: AgentInput[];
}

// ── Shared enums / literals ──────────────────────────────────────────

export type GenerationStatus = "success" | "failed";

export type DebateStatus = "pending" | "in_progress" | "completed" | "failed";

// ── Round 1 — Opening Statements ─────────────────────────────────────

export interface Round1Entry {
    agent_role: string;
    stance: string;
    key_points: string[];
    confidence: number;
    generation_status: GenerationStatus;
    error?: string;
}

// ── Round 2 — Cross Examination ──────────────────────────────────────

export interface Round2Entry {
    challenger: string;
    responder: string;
    challenge: string;
    response: string;
    rebuttal: string;
    generation_status: GenerationStatus;
    error?: string;
}

// ── Round 3 — Final Synthesis ────────────────────────────────────────

export interface Round3Entry {
    agent_role: string;
    final_stance: string;
    what_changed: string;
    remaining_concerns: string[];
    recommendation: string;
    generation_status: GenerationStatus;
    error?: string;
}

// ── Composite round data ─────────────────────────────────────────────

export type RoundData = Round1Entry[] | Round2Entry[] | Round3Entry[];

// ── Response types — POST /debates/start ─────────────────────────────

export interface DebateResult {
    round1: Round1Entry[];
    round2: Round2Entry[];
    round3: Round3Entry[];
}

export interface DebateStartResponse {
    debate_id: string;
    question: string;
    status: DebateStatus;
    result: DebateResult;
}

// ── Response types — GET /debates/:id ────────────────────────────────

export interface AgentResponse {
    id: string;
    role: string;
    config: Record<string, unknown>;
}

export interface RoundResponse {
    id: string;
    round_number: number;
    data: RoundData;
}

export interface DebateResponse {
    id: string;
    question: string;
    status: DebateStatus;
    created_at: string;
    agents: AgentResponse[];
    rounds: RoundResponse[];
}
