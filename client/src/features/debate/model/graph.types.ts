/* ── Frontend Graph Model ─────────────────────────────────────── */

export type GraphNodeKind =
    | "question"
    | "agent"
    | "synthesis"
    | "intermediate"
    | "followup-question"
    | "followup-agent"
    | "followup-intermediate"
    | "followup-synthesis";

export type GraphEdgeKind =
    | "initial"
    | "supports"
    | "challenges"
    | "questions"
    | "summarizes";

export type GraphNodeStatus =
    | "hidden"
    | "entering"
    | "visible"
    | "active"
    | "completed"
    | "failed";

export type GraphEdgeStatus =
    | "hidden"
    | "drawing"
    | "visible"
    | "active"
    | "completed"
    | "failed";

export interface DebateGraphNode {
    id: string;
    kind: GraphNodeKind;
    label: string;
    round: number;
    status: GraphNodeStatus;
    summary?: string;
    agentId?: string;
    agentRole?: string;
    agentModel?: string;
    agentProvider?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    /** Optional knowledge attachment summary used by AgentNode to render a badge. */
    knowledge?: {
        mode: "no_docs" | "shared_session_docs" | "assigned_docs_only" | string;
        docCount: number;
    };
    /** Cycle this node belongs to (1 = initial debate, 2+ = follow-up cycles). */
    cycle?: number;
}

export interface DebateGraphEdge {
    id: string;
    source: string;
    target: string;
    kind: GraphEdgeKind;
    round: number;
    status: GraphEdgeStatus;
    label?: string;
}

export interface DebateGraph {
    nodes: DebateGraphNode[];
    edges: DebateGraphEdge[];
}

/* ── Timeline Model ──────────────────────────────────────────── */

export type RoundPhase = "initial" | "critique" | "final";

export interface TimelineRound {
    roundNumber: number;
    roundType: RoundPhase;
    status: "pending" | "active" | "completed" | "failed";
    label: string;
    agentCount: number;
}

/* ── Moderator Model ─────────────────────────────────────────── */

export interface ModeratorState {
    status: string;
    explanation: string;
    watchFor: string[];
    activityFeed: ActivityItem[];
}

export interface ActivityItem {
    id: string;
    timestamp: string;
    text: string;
    type: "info" | "agent" | "round" | "error" | "synthesis";
    relatedNodeId?: string;
}
