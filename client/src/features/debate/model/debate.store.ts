import { create } from "zustand";
import type {
    AgentDTO,
    DebateStartResponse,
    SessionDetailDTO,
    WsEvent,
} from "../api/debate.types";
import {
    getDebateDetail,
    startDebate as startDebateApi,
} from "../api/debate.api";
import { debateWs } from "../api/debate.ws";
import { useGraphStore } from "./graph.store";
import { useModeratorStore } from "./moderator.store";
import { usePlaybackStore } from "./playback.store";
import { useAnimationStore } from "./animation/animation.store";
import {
    sessionToAnimationSteps,
    wsEventToAnimationSteps,
} from "./animation/animation.converter";
import { formatRound1Summary, formatRound2Summary, getTurnSummary } from "./formatters";
import { shouldSkipGraphInference } from "./error-normalizer";

interface DebateStore {
    session: SessionDetailDTO | null;
    agents: AgentDTO[];
    debateId: string | null;
    turnId: string | null;
    turnStatus: string | null;
    currentRound: number;
    loading: boolean;
    error: string | null;
    wsConnected: boolean;

    startDebate: (
        question: string,
        agents: { role: string; config: Record<string, unknown> }[],
    ) => Promise<DebateStartResponse>;
    loadDebate: (debateId: string, options?: { silent?: boolean }) => Promise<void>;
    handleWsEvent: (event: WsEvent) => void;
    reset: () => void;
}

export const useDebateStore = create<DebateStore>((set, get) => ({
    session: null,
    agents: [],
    debateId: null,
    turnId: null,
    turnStatus: null,
    currentRound: 0,
    loading: false,
    error: null,
    wsConnected: false,

    startDebate: async (question, agents) => {
        set({ loading: true, error: null });
        try {
            const response = await startDebateApi({ question, agents });
            set({
                debateId: response.debate_id,
                turnId: response.turn_id,
                turnStatus: "queued",
                currentRound: 0,
                loading: false,
            });

            // Connect WebSocket
            debateWs.connect(response.turn_id);
            debateWs.subscribe(get().handleWsEvent);
            set({ wsConnected: true });

            return response;
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Failed to start debate";
            set({ error: msg, loading: false });
            throw err;
        }
    },

    loadDebate: async (debateId, options) => {
        const silent = Boolean(options?.silent);
        if (!silent) {
            set({ loading: true, error: null });
        }

        try {
            const session = await getDebateDetail(debateId);
            const agents = session.agents ?? [];
            const turn = session.latest_turn;
            const runningRound = turn?.rounds?.find((r) => r.status === "running")?.round_number;
            const currentRound =
                runningRound
                ?? (turn?.rounds?.length
                    ? Math.max(...turn.rounds.map((r) => r.round_number))
                    : (turn?.status === "queued" || turn?.status === "running" ? 1 : 0));

            set({
                session,
                agents,
                debateId: session.id,
                turnId: turn?.id ?? null,
                turnStatus: turn?.status ?? null,
                currentRound,
                loading: silent ? get().loading : false,
            });

            // Hydrate playback
            usePlaybackStore.getState().setMaxRound(currentRound || 3);

            const isFinished =
                !turn || (turn.status !== "queued" && turn.status !== "running");
            const hasExistingGraph = useGraphStore.getState().graph.nodes.length > 0;

            if (isFinished) {
                const fromLiveFlow = silent || hasExistingGraph;

                useModeratorStore.getState().updateFromSession(session, currentRound);

                if (fromLiveFlow) {
                    // Keep final state stable for live debates instead of replay-resetting.
                    useGraphStore.getState().mergeFromSession(session);
                    useAnimationStore.getState().reset();
                    return;
                }

                let steps: ReturnType<typeof sessionToAnimationSteps> = [];
                try {
                    steps = sessionToAnimationSteps(session);
                } catch (e) {
                    console.warn("[Agora] sessionToAnimationSteps failed:", e);
                }

                if (steps.length === 0) {
                    // Fallback: no animation steps — render static visible graph
                    console.warn("[Agora] No animation steps generated, falling back to static graph");
                    useGraphStore.getState().hydrateFromSession(session);
                } else {
                    useGraphStore.getState().hydrateHidden(session);
                    const anim = useAnimationStore.getState();
                    anim.reset();
                    anim.enqueueSteps(steps);
                    // Don't auto-play — user controls via "Next Step" button
                    // anim.play();

                    // Safety net: if nothing becomes visible within 15s, force static render
                    setTimeout(() => {
                        const g = useGraphStore.getState().graph;
                        const anyVisible = g.nodes.some((n) => n.status !== "hidden");
                        if (!anyVisible && g.nodes.length > 0) {
                            console.warn("[Agora] Animation stalled — forcing static graph");
                            useAnimationStore.getState().reset();
                            useGraphStore.getState().hydrateFromSession(session);
                        }
                    }, 15000);
                }
            } else {
                // Still running — hydrate what we have, live events will animate
                if (silent && hasExistingGraph) {
                    useGraphStore.getState().mergeFromSession(session);
                } else {
                    useGraphStore.getState().hydrateFromSession(session);
                }
                useModeratorStore.getState().updateFromSession(session, currentRound);
                if (!get().wsConnected) {
                    debateWs.connect(turn!.id);
                    debateWs.subscribe(get().handleWsEvent);
                    set({ wsConnected: true });
                }
            }
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Failed to load debate";
            if (!silent) {
                set({ error: msg, loading: false });
            } else {
                console.warn("[Agora] Silent debate refresh failed:", msg);
            }
        }
    },

    handleWsEvent: (event) => {
        const state = get();

        switch (event.type) {
            case "turn_started":
                set({ turnStatus: "running" });
                break;

            case "round_started":
                set({ currentRound: event.round_number ?? state.currentRound });
                usePlaybackStore
                    .getState()
                    .setCurrentRound(event.round_number ?? state.currentRound);
                break;

            case "turn_completed":
                set({ turnStatus: "completed" });
                // Reload full session once to capture final summary/synthesis.
                if (state.debateId) {
                    getDebateDetail(state.debateId).then((session) => {
                        const turn = session.latest_turn;
                        set({
                            session,
                            agents: session.agents ?? [],
                            turnStatus: turn?.status ?? "completed",
                            currentRound: 3,
                        });
                        useGraphStore.getState().mergeFromSession(session);
                        useModeratorStore.getState().updateFromSession(session, 3);
                    });
                }
                break;

            case "turn_failed":
                set({
                    turnStatus: "failed",
                    error:
                        typeof event.payload?.["error"] === "string"
                            ? (event.payload["error"] as string)
                            : "Debate execution failed",
                });
                useGraphStore.getState().markRunningNodesFailed();
                break;

            default:
                break;
        }

        // Forward to animation pipeline (replaces direct graph mutation)
        const animSteps = wsEventToAnimationSteps(event, state.agents);
        if (animSteps.length > 0) {
            const anim = useAnimationStore.getState();
            anim.enqueueSteps(animSteps);
            if (!anim.isPlaying) anim.play();
        }

        // ── Live content hydration ──────────────────────────────
        // Animation steps handle visual state (enter/activate/complete),
        // but node content (summary, text) must be applied directly.
        if (event.type === "message_created" && event.agent_id) {
            const payload = event.payload ?? {};
            const skipGraphInference = shouldSkipGraphInference(payload);
            const rn = event.round_number ?? 1;
            const rawContent =
                typeof payload["content"] === "string"
                    ? (payload["content"] as string)
                    : "";
            const generationStatus =
                typeof payload["generation_status"] === "string"
                    ? String(payload["generation_status"]).toLowerCase()
                    : "success";
            const failed = generationStatus === "failed" || skipGraphInference;
            const agentObj = state.agents.find(
                (a) => a.id === event.agent_id,
            );
            const role = agentObj?.role;

            if (rn === 1) {
                // Round 1: update agent node with initial stance
                const nodeId = `agent-${event.agent_id}`;
                useGraphStore.getState().updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : formatRound1Summary(rawContent),
                    content: rawContent,
                    metadata: { loading: false, failed },
                });
                if (failed) {
                    useGraphStore.getState().setNodeStatus(nodeId, "failed");
                }
            } else if (rn === 2) {
                // Round 2: update intermediate node with critique content
                const nodeId = `agent-${event.agent_id}-r2`;
                const targetNodeId = skipGraphInference
                    ? null
                    : inferLiveTarget(
                        payload,
                        state.agents,
                        `agent-${event.agent_id}`,
                    );
                const targetAgent = targetNodeId
                    ? state.agents.find((a) => `agent-${a.id}` === targetNodeId)
                    : undefined;
                useGraphStore.getState().updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : formatRound2Summary(
                            rawContent,
                            role,
                            targetAgent?.role,
                        ),
                    content: rawContent,
                    metadata: { loading: false, failed },
                });
                if (failed) {
                    useGraphStore.getState().setNodeStatus(nodeId, "failed");
                }
            } else if (rn === 3) {
                // Round 3: update agent node with final contribution
                const nodeId = `agent-${event.agent_id}`;
                useGraphStore.getState().updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : getTurnSummary({
                            raw: rawContent,
                            round: 3,
                            sourceRole: role,
                        }),
                    content: rawContent,
                    metadata: { loading: false, failed },
                });
                if (failed) {
                    useGraphStore.getState().setNodeStatus(nodeId, "failed");
                }
            }
        }

        // If turn_completed provides a final summary, hydrate the synthesis node
        if (event.type === "turn_completed") {
            const payload = event.payload ?? {};
            const summaryText =
                typeof payload["summary"] === "string"
                    ? (payload["summary"] as string)
                    : typeof payload["text"] === "string"
                        ? (payload["text"] as string)
                        : null;
            if (summaryText) {
                useGraphStore.getState().updateNodeData("synthesis-node", {
                    summary: getTurnSummary({
                        raw: summaryText,
                        round: 3,
                        kind: "synthesis",
                        maxLen: 200,
                    }),
                    content: summaryText,
                    metadata: { loading: false, failed: false },
                });
            }
        }

        // Safety: ensure question node is visible for live debates
        const g = useGraphStore.getState().graph;
        const qNode = g.nodes.find((n) => n.id === "question-node");
        if (qNode && qNode.status === "hidden") {
            useGraphStore.getState().setNodeStatus("question-node", "visible");
        }

        // Forward to moderator activity feed
        useModeratorStore.getState().addActivity(event);
    },

    reset: () => {
        debateWs.disconnect();
        set({
            session: null,
            agents: [],
            debateId: null,
            turnId: null,
            turnStatus: null,
            currentRound: 0,
            loading: false,
            error: null,
            wsConnected: false,
        });
        useGraphStore.getState().reset();
        useModeratorStore.getState().reset();
        usePlaybackStore.getState().reset();
        useAnimationStore.getState().reset();
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** Infer the target agent node for a round-2 message from WS event payload */
function inferLiveTarget(
    payload: Record<string, unknown>,
    agents: AgentDTO[],
    sourceNodeId: string,
): string {
    if (typeof payload["target_agent"] === "string") {
        const target = agents.find(
            (a) =>
                a.id === payload["target_agent"] ||
                a.role === payload["target_agent"],
        );
        if (target) return `agent-${target.id}`;
    }
    if (Array.isArray(payload["references"])) {
        const refs = payload["references"] as string[];
        const refAgent = agents.find(
            (a) => refs.includes(a.id) || refs.includes(a.role),
        );
        if (refAgent) return `agent-${refAgent.id}`;
    }
    const others = agents.filter((a) => `agent-${a.id}` !== sourceNodeId);
    if (others.length > 0) return `agent-${others[0].id}`;
    return "question-node";
}
