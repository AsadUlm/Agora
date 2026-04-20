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
    loadDebate: (debateId: string) => Promise<void>;
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

    loadDebate: async (debateId) => {
        set({ loading: true, error: null });
        try {
            const session = await getDebateDetail(debateId);
            const agents = session.agents ?? [];
            const turn = session.latest_turn;
            const currentRound =
                turn?.rounds?.length
                    ? Math.max(...turn.rounds.map((r) => r.round_number))
                    : 0;

            set({
                session,
                agents,
                debateId: session.id,
                turnId: turn?.id ?? null,
                turnStatus: turn?.status ?? null,
                currentRound,
                loading: false,
            });

            // Hydrate playback
            usePlaybackStore.getState().setMaxRound(currentRound || 3);

            const isFinished =
                !turn || (turn.status !== "queued" && turn.status !== "running");

            if (isFinished) {
                // Cinematic replay: load graph hidden, then animate
                useModeratorStore.getState().updateFromSession(session, currentRound);

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
                    anim.play();

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
                useGraphStore.getState().hydrateFromSession(session);
                useModeratorStore.getState().updateFromSession(session, currentRound);
                debateWs.connect(turn!.id);
                debateWs.subscribe(get().handleWsEvent);
                set({ wsConnected: true });
            }
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Failed to load debate";
            set({ error: msg, loading: false });
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
                // Reload full session for final state  
                if (state.debateId) {
                    getDebateDetail(state.debateId).then((session) => {
                        set({ session, agents: session.agents ?? [] });
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
