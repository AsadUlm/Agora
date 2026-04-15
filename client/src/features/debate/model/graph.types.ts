/* ── Frontend Graph Model ─────────────────────────────────────── */

export type GraphNodeKind = "question" | "agent" | "synthesis" | "intermediate";

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
    | "completed";

export type GraphEdgeStatus = "hidden" | "drawing" | "visible";

export interface DebateGraphNode {
    id: string;
    kind: GraphNodeKind;
    label: string;
    round: number;
    status: GraphNodeStatus;
    summary?: string;
    agentId?: string;
    agentRole?: string;
    content?: string;
    metadata?: Record<string, unknown>;
}

export interface DebateGraphEdge {
    id: string;
    source: string;
    target: string;
    kind: GraphEdgeKind;
    round: number;
    status: GraphNodeStatus | GraphEdgeStatus;
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
