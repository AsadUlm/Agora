/* ── Animation Timeline Types ─────────────────────────────────── */

export type AnimationStepType =
    | "node_enter" // node transitions from hidden → visible (scale-in)
    | "node_activate" // node transitions to active (glow / pulse)
    | "node_complete" // node transitions to completed (settle)
    | "edge_draw" // edge animates into existence (stroke-dashoffset)
    | "focus_node" // camera/focus locks onto a node, dims others
    | "unfocus_all" // clears focus, restores all opacities
    | "moderator_update" // updates moderator panel text
    | "delay"; // pure wait step

export interface AnimationStep {
    id: string;
    type: AnimationStepType;
    /** Node or edge target */
    targetId?: string;
    /** For edge_draw steps */
    edge?: {
        id: string;
        source: string;
        target: string;
        kind: string;
    };
    /** How long this step's visual effect takes (ms). Scaled by speed. */
    duration: number;
    /** Extra wait before the next step starts (ms). Scaled by speed. */
    delay: number;
    /** Moderator text for moderator_update steps */
    moderator?: {
        status?: string;
        explanation?: string;
        watchFor?: string[];
    };
    /** Arbitrary metadata (e.g. agent role, round number) */
    meta?: Record<string, unknown>;
}

export type GraphNodeAnimState =
    | "hidden"
    | "entering"
    | "visible"
    | "active"
    | "completed";

export type GraphEdgeAnimState = "hidden" | "drawing" | "visible";
