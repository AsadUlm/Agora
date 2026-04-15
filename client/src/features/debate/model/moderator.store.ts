import { create } from "zustand";
import type { SessionDetailDTO, WsEvent } from "../api/debate.types";
import type { ActivityItem, ModeratorState } from "./graph.types";
import { buildModeratorState } from "./graph.mapper";
import { isErrorPayload, normalizeAgentError, formatModeratorError } from "./error-normalizer";
import { formatModeratorEvent } from "./formatters";

interface ModeratorStore extends ModeratorState {
    updateFromSession: (
        session: SessionDetailDTO,
        currentRound: number,
    ) => void;
    addActivity: (event: WsEvent) => void;
    reset: () => void;
}

const initialState: ModeratorState = {
    status: "Waiting",
    explanation: "Start a debate to see the reasoning unfold.",
    watchFor: [],
    activityFeed: [],
};

export const useModeratorStore = create<ModeratorStore>((set, get) => ({
    ...initialState,

    updateFromSession: (session, currentRound) => {
        const state = buildModeratorState(session, currentRound);
        set(state);
    },

    addActivity: (event) => {
        const feed = [...get().activityFeed];
        const item = wsEventToActivity(event);
        if (item) {
            feed.push(item);
            // Keep last 50 items
            if (feed.length > 50) feed.shift();
        }

        // Update status/explanation based on event
        const updates: Partial<ModeratorState> = { activityFeed: feed };

        switch (event.type) {
            case "turn_started":
                updates.status = "Live";
                updates.explanation = "The debate has begun. Agents are being activated.";
                break;
            case "round_started":
                updates.status = `Round ${event.round_number}`;
                if (event.round_number === 1) {
                    updates.explanation =
                        "Agents are forming their initial perspectives on the question.";
                    updates.watchFor = [
                        "Agent nodes appearing on the graph",
                        "Initial stances forming",
                    ];
                } else if (event.round_number === 2) {
                    updates.explanation =
                        "Agents are now engaging with each other's arguments. This is where the real debate happens.";
                    updates.watchFor = [
                        "Challenge edges (red/pink)",
                        "Support edges (green)",
                        "Emerging clusters",
                    ];
                } else if (event.round_number === 3) {
                    updates.explanation =
                        "The debate is converging. A synthesis of the strongest arguments is being formed.";
                    updates.watchFor = [
                        "Synthesis node appearing",
                        "Final convergence",
                    ];
                }
                break;
            case "round_completed":
                updates.explanation = `Round ${event.round_number} complete. ${event.round_number < 3
                    ? "Preparing next round..."
                    : "Finalizing synthesis..."
                    }`;
                break;
            case "turn_completed":
                updates.status = "Completed";
                updates.explanation =
                    "The debate has concluded. Review the graph to explore all arguments and the final synthesis.";
                updates.watchFor = [];
                break;
            case "turn_failed":
                updates.status = "Failed";
                updates.explanation =
                    typeof event.payload?.["error"] === "string"
                        ? `Error: ${event.payload["error"]}`
                        : "The debate failed to complete.";
                break;
        }

        set(updates);
    },

    reset: () => set(initialState),
}));

let _activitySeq = 0;

function wsEventToActivity(event: WsEvent): ActivityItem | null {
    const base = {
        id: `ws-${event.type}-${event.timestamp}-${++_activitySeq}`,
        timestamp: event.timestamp,
    };

    switch (event.type) {
        case "turn_started":
            return { ...base, text: "Debate execution started", type: "info" };
        case "round_started": {
            const roundLabels: Record<number, string> = {
                1: "initial",
                2: "critique",
                3: "final",
            };
            const label = roundLabels[event.round_number ?? 0] ?? "";
            return {
                ...base,
                text: `Round ${event.round_number}${label ? ` (${label})` : ""} started`,
                type: "round",
            };
        }
        case "agent_started": {
            const role = event.payload?.["agent_role"] as string | undefined;
            const displayName = role
                ? role.charAt(0).toUpperCase() + role.slice(1)
                : "Agent";
            const rn = event.round_number ?? 1;
            const relatedNodeId = event.agent_id
                ? (rn === 2 ? `agent-${event.agent_id}-r2` : `agent-${event.agent_id}`)
                : undefined;
            return {
                ...base,
                text: `${displayName} is thinking…`,
                type: "agent",
                relatedNodeId,
            };
        }
        case "message_created": {
            // Detect error payloads
            if (event.payload && isErrorPayload(event.payload)) {
                const normalized = normalizeAgentError(
                    event.payload,
                    event.agent_id,
                    null,
                );
                return {
                    ...base,
                    text: formatModeratorError(normalized.agentRole ?? event.agent_id?.slice(0, 8) ?? "Agent", normalized.errorType),
                    type: "error",
                };
            }

            const rawContent =
                typeof event.payload?.["content"] === "string"
                    ? (event.payload["content"] as string)
                    : "";
            const agentRole = event.payload?.["agent_role"] as string | undefined;
            const msgType = event.payload?.["message_type"] as string | undefined;
            const roundNum = event.round_number ?? 1;
            const relatedNodeId = event.agent_id
                ? (roundNum === 2 ? `agent-${event.agent_id}-r2` : `agent-${event.agent_id}`)
                : undefined;

            const formatted = formatModeratorEvent(agentRole, rawContent, msgType, roundNum);
            return { ...base, text: formatted.title, type: "agent", relatedNodeId };
        }
        case "round_completed":
            return {
                ...base,
                text: `Round ${event.round_number} completed`,
                type: "round",
            };
        case "turn_completed":
            return {
                ...base,
                text: "Debate completed successfully",
                type: "synthesis",
            };
        case "turn_failed":
            return { ...base, text: "Debate execution failed", type: "error" };
        default:
            return null;
    }
}
