/* ── Backend DTOs (aligned with server/app/schemas/debate.py) ──── */

// ── Debate Trace types (5-stage traceable pipeline) ───────────────

export interface CritiqueTraceItem {
    id: string;
    from_agent_id: string;
    from_agent_name: string;
    to_agent_id: string;
    to_agent_name: string;
    target_claim: string;
    critique_summary: string;
    weakness_found: string;
    severity?: string;
}

export interface CritiqueResponseTraceItem {
    id: string;
    agent_id: string;
    agent_name: string;
    received_critique_summary: string;
    response: string;
    accepted_points: string[];
    rejected_points: string[];
    planned_revision: string;
    stance_update?: string;
}

export interface RevisedPositionTraceItem {
    id: string;
    agent_id: string;
    agent_name: string;
    initial_position_summary: string;
    revised_position: string;
    change_summary: string;
    changed: boolean;
    change_type: string;
    reason_for_change: string;
    key_claims?: string[];
}

export interface ImportantChange {
    agent_id: string;
    agent_name: string;
    before: string;
    after: string;
    why_changed: string;
}

export interface DebateImpact {
    initial_consensus: string;
    major_disagreements: string[];
    important_changes: ImportantChange[];
    how_debate_improved_answer: string;
    single_llm_risk_avoided: string;
}

export interface DebateTrace {
    critiques: CritiqueTraceItem[];
    critique_responses: CritiqueResponseTraceItem[];
    revised_positions: RevisedPositionTraceItem[];
    debate_impact: DebateImpact | null;
}

export interface GenerationErrorMetadata {
    code: string;
    message: string;
    user_message?: string;
    retryable: boolean;
    severity: "fatal" | "recoverable" | "partial";
    phase: string | null;
    failed_agents: string[];
    successful_agents: string[];
    partial_results_available: boolean;
    request_id: string | null;
    last_successful_stage: number | null;
    provider?: string | null;
    model?: string | null;
    status_code?: number | null;
    round_number?: number | null;
    round_type?: string | null;
    timestamp?: string;
}

// ── Core DTOs ─────────────────────────────────────────────────────

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
    /** Document UUIDs explicitly bound to this agent (assigned_docs_only). */
    document_ids?: string[];
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
    cycle_number?: number;
    round_type: string; // initial | critique | critique_response | revised_position | final | followup_response | followup_critique | updated_synthesis
    status: string; // queued | running | partially_completed | completed | failed
    started_at: string | null;
    ended_at: string | null;
    messages: MessageDTO[];
}

export interface UserMessageDTO {
    content: string;
    created_at: string;
}

export interface DebateFollowUpDTO {
    id: string;
    chat_turn_id: string;
    cycle_number: number;
    question: string;
    created_at: string;
}

export interface TurnDTO {
    id: string;
    turn_index: number;
    status: string; // queued | running | partially_completed | completed | failed
    current_stage?: number | null;
    synthesis_status?: "pending" | "running" | "completed" | "failed" | "skipped";
    request_id?: string | null;
    error?: GenerationErrorMetadata | null;
    started_at: string | null;
    ended_at: string | null;
    user_message: UserMessageDTO | null;
    rounds: RoundDTO[];
    final_summary: Record<string, unknown> | null;
    execution_mode?: "auto" | "manual";
    follow_ups?: DebateFollowUpDTO[];
    /** Structured debate trace for Debate History / Agent Evolution / traceability. */
    debate_trace?: DebateTrace | null;
    /** True when this turn was generated with the 5-stage traceable pipeline. */
    is_5stage_pipeline?: boolean;
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
    session_id?: string;
    execution_mode?: "auto" | "manual";
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
    | "round_failed"
    | "turn_completed"
    | "turn_partially_completed"
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
    /** Step 30: backend storage backend ("local" | "cloudinary"). */
    storage_provider?: string;
    /** Step 30: file size in bytes, when known. */
    bytes?: number | null;
}

export interface DocumentAllItemDTO extends DocumentDTO {
    session_title: string | null;
    storage_url?: string | null;
}

/** Step 30: one failed file in a batch upload. */
export interface DocumentUploadFailureDTO {
    filename: string;
    error: string;
}

/** Step 30: response from POST /documents/upload-batch. */
export interface DocumentUploadBatchResponseDTO {
    uploaded: DocumentDTO[];
    failed: DocumentUploadFailureDTO[];
}
