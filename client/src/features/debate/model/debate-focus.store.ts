import { create } from "zustand";

/**
 * Typed focus target for the Debate Process panel.
 * When a graph node or edge is clicked, the canvas dispatches one of these
 * and the panel scrolls+highlights the matching card.
 */
export type DebateProcessFocusTarget =
    | { type: "question" }
    | { type: "round1"; agentId: string }
    | { type: "critique"; sourceAgentId: string; targetAgentId: string }
    | { type: "response"; respondingAgentId: string; respondingToAgentId: string }
    | { type: "revision"; agentId: string }
    | { type: "final" };

/**
 * Maps a focus target to the stable DOM anchor id in DebateThreadView.
 */
export function resolveProcessAnchorId(target: DebateProcessFocusTarget): string {
    switch (target.type) {
        case "question":
            return "process-question";
        case "round1":
            return `process-round1-${target.agentId}`;
        case "critique":
            return `process-critique-${target.sourceAgentId}-${target.targetAgentId}`;
        case "response":
            return `process-response-${target.respondingAgentId}-${target.respondingToAgentId}`;
        case "revision":
            return `process-revision-${target.agentId}`;
        case "final":
            return "process-final-verdict";
    }
}

interface DebateFocusStore {
    focusTarget: DebateProcessFocusTarget | null;
    setFocusTarget: (target: DebateProcessFocusTarget) => void;
    clearFocusTarget: () => void;
}

export const useDebateFocusStore = create<DebateFocusStore>((set) => ({
    focusTarget: null,
    setFocusTarget: (target) => set({ focusTarget: target }),
    clearFocusTarget: () => set({ focusTarget: null }),
}));
