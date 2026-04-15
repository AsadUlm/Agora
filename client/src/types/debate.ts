/* ------------------------------------------------------------------ */
/*  Debate domain types — mirrors backend response shapes              */
/* ------------------------------------------------------------------ */

export type GenerationStatus = "success" | "failed" | "skipped" | "completed";
export type RoundType = "initial" | "critique" | "final";
export type DebateStatus = "idle" | "queued" | "running" | "completed" | "failed" | "unknown";
export type TurnStatus = "queued" | "running" | "completed" | "failed";

// -- Structured payload shapes (inside MessageDTO.payload / text) -----

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

// -- Backend DTOs (match server response contracts exactly) -----------

export interface AgentDTO {
    id: string;
    role: string;
    provider: string;
    model: string;
    temperature: number;
    reasoning_style: string;
    position_order: number;
}

export interface MessageDTO {
    id: string;
    agent_id: string | null;
    agent_role: string | null;
    message_type: string;
    sender_type: string;
    payload: Record<string, unknown>;
    text: string;
    sequence_no: number;
    created_at: string;
}

export interface RoundDTO {
    id: string;
    round_number: number;
    round_type: RoundType;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    messages: MessageDTO[];
}

export interface TurnDTO {
    id: string;
    turn_index: number;
    status: TurnStatus;
    started_at: string | null;
    ended_at: string | null;
    user_message: {
        content: string;
        created_at: string;
    };
    rounds: RoundDTO[];
    final_summary: Record<string, unknown> | null;
}

export interface SessionDetailDTO {
    id: string;
    title: string;
    question: string;
    status: DebateStatus;
    created_at: string;
    updated_at: string;
    agents: AgentDTO[];
    latest_turn: TurnDTO | null;
}

export interface SessionListItemDTO {
    id: string;
    title: string;
    question: string;
    status: DebateStatus;
    created_at: string;
    updated_at: string;
}

// -- Request types -----------------------------------------------------

export interface AgentModelConfig {
    provider: string;
    model: string;
    temperature: number;
}

export interface AgentReasoningConfig {
    style: string;
    depth: string;
}

export interface AgentConfig {
    model: AgentModelConfig;
    reasoning: AgentReasoningConfig;
}

export interface AgentCreateRequest {
    role: string;
    config: AgentConfig;
}

export interface DebateStartRequest {
    question: string;
    agents: AgentCreateRequest[];
}

export interface DebateStartResponse {
    debate_id: string;
    turn_id: string;
    question: string;
    status: DebateStatus;
    ws_session_url: string;
    ws_turn_url: string;
}

// -- Document DTOs -----------------------------------------------------

export interface DocumentDTO {
    id: string;
    filename: string;
    status: string;
    created_at: string;
    session_id: string;
}

// -- Legacy aliases for backward compat with HomePage -----------------

export type DebateAgent = AgentDTO;
export type DebateListItem = SessionListItemDTO;

export interface RoundDataEntry {
    agent_id: string;
    message_type: string;
    data: Record<string, unknown>;
}

export interface DebateDetail {
    id: string;
    question: string;
    status: DebateStatus;
    created_at: string;
    agents: AgentDTO[];
    rounds: RoundDTO[];
}

export interface AgentRoundResult {
    agent_id: string;
    role: string;
    content: string;
    structured: Record<string, unknown>;
    generation_status: GenerationStatus;
    error: string | null;
}
