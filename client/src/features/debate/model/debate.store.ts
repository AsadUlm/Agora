import { create } from "zustand";
import type {
    AgentDTO,
    DebateStartResponse,
    SessionDetailDTO,
    WsEvent,
} from "../api/debate.types";
import {
    getDebateDetail,
    resumeDebate,
    getStepState,
    nextStep as nextStepApi,
    postFollowUp,
    startDebate as startDebateApi,
    switchToAutoRun as switchToAutoRunApi,
} from "../api/debate.api";
import { debateWs } from "../api/debate.ws";
import { useGraphStore } from "./graph.store";
import { useModeratorStore } from "./moderator.store";
import { usePlaybackStore } from "./playback.store";
import { useAnimationStore } from "./animation/animation.store";
import { formatRound1Summary, formatRound2Summary, getTurnSummary, normalizeSummary } from "./formatters";
import { shouldSkipGraphInference } from "./error-normalizer";

interface PendingStepInfo {
    round_number: number;
    agent_id: string;
    agent_role: string;
    message_type: string;
}

export type PlaybackMode = "paused" | "auto";

export type PlaybackQueueItem = { type: "node"; id: string };

interface CanonicalEdgeRef {
    id: string;
    source: string;
    target: string;
}

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
    executionMode: "auto" | "manual";
    currentlyGenerating: PendingStepInfo | null;
    pendingStep: PendingStepInfo | null;
    stepBusy: boolean;
    stepError: string | null;
    staleQueuedPolls: number;

    /** Frontend-only playback state. Backend execution is independent. */
    playbackMode: PlaybackMode;
    /** Whether this debate was opened in completed state from history. */
    openedAsCompleted: boolean;
    playbackQueue: PlaybackQueueItem[];
    revealedNodeIds: string[];
    revealedEdgeIds: string[];
    canonicalNodeCount: number;
    canonicalEdgeCount: number;
    renderedNodeCount: number;
    renderedEdgeCount: number;
    lastWsEventType: string | null;

    startDebate: (
        question: string,
        agents: { role: string; config: Record<string, unknown> }[],
        executionMode?: "auto" | "manual",
        options?: { sessionId?: string },
    ) => Promise<DebateStartResponse>;
    loadDebate: (debateId: string, options?: { silent?: boolean }) => Promise<void>;
    handleWsEvent: (event: WsEvent) => void;
    requestNextStep: () => Promise<void>;
    enableAutoRun: () => Promise<void>;
    submitFollowUp: (question: string) => Promise<void>;
    syncStepState: () => Promise<void>;
    reset: () => void;

    /** Toggle visual reveal mode (frontend only). */
    setPlaybackMode: (mode: PlaybackMode) => void;
    /** Add a response node to queue exactly once. */
    enqueuePlaybackNode: (nodeId: string) => void;
    /** Sync queue and revealed sets from canonical graph snapshot. */
    syncPlaybackFromCanonical: (params: {
        canonicalNodeIds: string[];
        canonicalEdges: CanonicalEdgeRef[];
        isLiveExecution: boolean;
        revealAll: boolean;
    }) => void;
    /** Reveal exactly one queued visual item without touching backend. */
    revealNextVisual: () => void;
    /** Expose actual ReactFlow input counts for dev diagnostics. */
    setRenderedCounts: (nodes: number, edges: number) => void;
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
    executionMode: "auto",
    currentlyGenerating: null,
    pendingStep: null,
    stepBusy: false,
    stepError: null,
    staleQueuedPolls: 0,
    playbackMode: "paused",
    openedAsCompleted: false,
    playbackQueue: [],
    revealedNodeIds: [],
    revealedEdgeIds: [],
    canonicalNodeCount: 0,
    canonicalEdgeCount: 0,
    renderedNodeCount: 0,
    renderedEdgeCount: 0,
    lastWsEventType: null,

    startDebate: async (question, agents, executionMode = "auto", options) => {
        set({ loading: true, error: null, executionMode });
        try {
            const response = await startDebateApi({
                question,
                agents,
                execution_mode: executionMode,
                ...(options?.sessionId ? { session_id: options.sessionId } : {}),
            });
            set({
                debateId: response.debate_id,
                turnId: response.turn_id,
                turnStatus: "queued",
                currentRound: 0,
                loading: false,
                executionMode,
                currentlyGenerating: null,
                pendingStep: null,
                staleQueuedPolls: 0,
                playbackMode: "auto",
                openedAsCompleted: false,
                playbackQueue: [],
                revealedNodeIds: [],
                revealedEdgeIds: [],
                canonicalNodeCount: 0,
                canonicalEdgeCount: 0,
                renderedNodeCount: 0,
                renderedEdgeCount: 0,
                lastWsEventType: null,
            });

            // Connect WebSocket
            debateWs.disconnect();
            debateWs.connect(response.turn_id);
            debateWs.subscribe(get().handleWsEvent);
            set({ wsConnected: true });

            // Manual mode is dev/experimental — only then does the backend
            // hold a gate that the UI must release. In auto mode the StepController
            // snapshot is irrelevant (gate is permanently open).
            if (executionMode === "manual") {
                void get().syncStepState();
            }

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
        const previousDebateId = get().debateId;
        const previousTurnId = get().turnId;
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

            const isLiveTurn = turn?.status === "queued" || turn?.status === "running";
            const switchedDebate = previousDebateId !== session.id;

            set({
                session,
                agents,
                debateId: session.id,
                turnId: turn?.id ?? null,
                turnStatus: turn?.status ?? null,
                currentRound,
                loading: silent ? get().loading : false,
                executionMode: (turn?.execution_mode === "auto" ? "auto" : turn?.execution_mode === "manual" ? "manual" : get().executionMode),
                ...(switchedDebate
                    ? {
                        playbackMode: isLiveTurn ? "auto" : "paused",
                        openedAsCompleted: !isLiveTurn,
                        playbackQueue: [],
                        revealedNodeIds: [],
                        revealedEdgeIds: [],
                        canonicalNodeCount: 0,
                        canonicalEdgeCount: 0,
                        renderedNodeCount: 0,
                        renderedEdgeCount: 0,
                        lastWsEventType: null,
                    }
                    : {}),
            });

            // Hydrate playback
            usePlaybackStore.getState().setMaxRound(currentRound || 3);

            const isFinished =
                !turn || (turn.status !== "queued" && turn.status !== "running");
            const hasExistingGraph = useGraphStore.getState().graph.nodes.length > 0;
            const shouldConnectLiveWs =
                Boolean(turn?.id)
                && isLiveTurn
                && (
                    switchedDebate
                    || !get().wsConnected
                    || previousTurnId !== turn?.id
                );

            if (!isLiveTurn && get().wsConnected) {
                debateWs.disconnect();
                set({ wsConnected: false });
            }

            if (isFinished) {
                useModeratorStore.getState().updateFromSession(session, currentRound);
                if (silent || hasExistingGraph) {
                    // Preserve in-memory node statuses for a live debate that just finished.
                    useGraphStore.getState().mergeFromSession(session);
                } else {
                    // Opening an already-completed debate from history should render immediately.
                    useGraphStore.getState().hydrateFromSession(session);
                }
            } else {
                // Still running — canonical graph is updated immediately as data arrives.
                if (silent && hasExistingGraph) {
                    useGraphStore.getState().mergeFromSession(session);
                } else {
                    useGraphStore.getState().hydrateFromSession(session);
                }
                useModeratorStore.getState().updateFromSession(session, currentRound);
                if (shouldConnectLiveWs) {
                    debateWs.disconnect();
                    debateWs.connect(turn!.id);
                    debateWs.subscribe(get().handleWsEvent);
                    set({ wsConnected: true });
                }
                // Only manual mode needs the StepController snapshot.
                // In auto mode (the normal flow) the gate is always open
                // and step-state polling would be pure noise.
                if (get().executionMode === "manual") {
                    void get().syncStepState();
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
        set({ lastWsEventType: event.type });

        if (import.meta.env.DEV) {
            const before = useGraphStore.getState().graph;
            // eslint-disable-next-line no-console
            console.log("[GRAPH] before canonical nodes", before.nodes.length);
        }

        if (import.meta.env.DEV) {
            const g = useGraphStore.getState().graph;
            // eslint-disable-next-line no-console
            console.debug(
                "[Agora][WS]", event.type,
                {
                    session_id: event.session_id,
                    turn_id: event.turn_id,
                    round: event.round_number,
                    agent_id: event.agent_id,
                    payload_keys: Object.keys(event.payload ?? {}),
                    nodes: g.nodes.length,
                    visible: g.nodes.filter((n) => n.status !== "hidden").length,
                },
            );
        }

        switch (event.type) {
            case "turn_started":
                set({ turnStatus: "running" });
                break;

            case "round_started":
                set({ currentRound: event.round_number ?? state.currentRound });
                usePlaybackStore
                    .getState()
                    .setCurrentRound(event.round_number ?? state.currentRound);
                // Follow-up cycles (rounds > 3): refresh canonical session so
                // the mapper can lay out the new cycle's nodes.
                if ((event.round_number ?? 0) > 3 && state.debateId) {
                    void get().loadDebate(state.debateId, { silent: true });
                }
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
                    currentlyGenerating: null,
                    pendingStep: null,
                    error:
                        typeof event.payload?.["error"] === "string"
                            ? (event.payload["error"] as string)
                            : "Debate execution failed",
                });
                useGraphStore.getState().markRunningNodesFailed();
                break;

            case "agent_started": {
                // agent_started fires BEFORE the gate wait — this step is
                // now PENDING (waiting for the user to click Next Step).
                const p = event.payload ?? {};
                const role = state.agents.find((a) => a.id === event.agent_id)?.role
                    ?? (typeof p["agent_role"] === "string" ? (p["agent_role"] as string) : "");
                const stepInfo = {
                    round_number: event.round_number ?? Number(p["round_number"] ?? 0),
                    agent_id: event.agent_id ?? String(p["agent_id"] ?? ""),
                    agent_role: role,
                    message_type: typeof p["message_type"] === "string" ? (p["message_type"] as string) : "",
                };
                set({
                    pendingStep: stepInfo,
                    currentlyGenerating: null, // not yet generating — waiting at gate
                });
                break;
            }

            case "message_created":
                // The LLM call finished — step is done, nothing is pending.
                set({ currentlyGenerating: null, pendingStep: null, stepError: null });
                break;

            default:
                break;
        }

        // ── Live content hydration ──────────────────────────────
        // Animation steps handle visual state (enter/activate/complete),
        // but node content (summary, text) must be applied directly.
        if (event.type === "message_created" && event.agent_id) {
            const payload = event.payload ?? {};
            const skipGraphInference = shouldSkipGraphInference(payload);
            const rn = event.round_number ?? 1;

            // Follow-up cycles (rounds > 3): defer to silent loadDebate.
            if (rn > 3) {
                if (state.debateId) {
                    void get().loadDebate(state.debateId, { silent: true });
                }
                return;
            }
            const rawContent =
                typeof payload["content"] === "string"
                    ? (payload["content"] as string)
                    : "";
            const displayContentHint =
                typeof payload["display_content"] === "string"
                    ? String(payload["display_content"]).trim()
                    : "";
            const shortSummaryHint =
                typeof payload["short_summary"] === "string"
                    ? String(payload["short_summary"]).trim()
                    : "";
            const isFallbackHint = payload["is_fallback"] === true;
            const generationStatus =
                typeof payload["generation_status"] === "string"
                    ? String(payload["generation_status"]).toLowerCase()
                    : "success";
            const failed = generationStatus === "failed" || skipGraphInference;
            const agentObj = state.agents.find(
                (a) => a.id === event.agent_id,
            );
            const role = agentObj?.role;
            const fallbackContent = getTurnSummary({
                raw: rawContent,
                round: rn,
                kind: rn === 2 ? "intermediate" : rn === 3 ? "synthesis" : undefined,
                sourceRole: role,
                maxLen: 220,
            });
            const safeContent = failed
                ? ""
                : displayContentHint || fallbackContent;

            const graphStore = useGraphStore.getState();
            const ensureVisible = (nodeId: string) => {
                const existing = graphStore.graph.nodes.find((n) => n.id === nodeId);
                if (!existing || existing.status === "hidden" || existing.status === "entering") {
                    graphStore.setNodeStatus(nodeId, failed ? "failed" : "completed");
                } else if (failed) {
                    graphStore.setNodeStatus(nodeId, "failed");
                }
            };

            if (rn === 1) {
                // Round 1: update agent node with initial stance
                const nodeId = `agent-${event.agent_id}`;
                // Ensure node exists even if mapper hasn't seeded it yet.
                graphStore.ensureNode({
                    id: nodeId,
                    kind: "agent",
                    label: role ?? "Agent",
                    round: 1,
                    status: "hidden",
                    agentId: event.agent_id,
                    agentRole: role,
                });
                graphStore.updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : normalizeSummary(
                            shortSummaryHint || formatRound1Summary(rawContent),
                            safeContent || rawContent || "Initial position prepared.",
                            200,
                        ),
                    content: safeContent,
                    metadata: {
                        loading: false,
                        failed,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                    },
                });
                ensureVisible(nodeId);
                get().enqueuePlaybackNode(nodeId);
                // Make sure the Q→agent edge is at least visible.
                graphStore.ensureEdge({
                    id: `edge-q-${event.agent_id}-r1`,
                    source: "question-node",
                    target: nodeId,
                    kind: "initial",
                    round: 1,
                    status: failed ? "failed" : "completed",
                });
                graphStore.setEdgeStatus(
                    `edge-q-${event.agent_id}-r1`,
                    failed ? "failed" : "completed",
                );
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
                // Ensure intermediate node exists even if WS missed agent_started/round_started.
                graphStore.ensureNode({
                    id: nodeId,
                    kind: "intermediate",
                    label: role ?? "Agent",
                    round: 2,
                    status: "hidden",
                    agentId: event.agent_id,
                    agentRole: role,
                });
                // Ensure continuation edge from base agent → intermediate.
                graphStore.ensureEdge({
                    id: `edge-${event.agent_id}-cont`,
                    source: `agent-${event.agent_id}`,
                    target: nodeId,
                    kind: "initial",
                    round: 2,
                    status: failed ? "failed" : "completed",
                });
                graphStore.setEdgeStatus(
                    `edge-${event.agent_id}-cont`,
                    failed ? "failed" : "completed",
                );
                graphStore.updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : normalizeSummary(
                            shortSummaryHint || formatRound2Summary(
                                rawContent,
                                role,
                                targetAgent?.role,
                            ),
                            safeContent || rawContent || "Critique prepared.",
                            200,
                        ),
                    content: safeContent,
                    metadata: {
                        loading: false,
                        failed,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                    },
                });
                ensureVisible(nodeId);
                get().enqueuePlaybackNode(nodeId);
            } else if (rn === 3) {
                // Round 3: update agent node with final contribution
                const nodeId = `agent-${event.agent_id}`;
                graphStore.ensureNode({
                    id: nodeId,
                    kind: "agent",
                    label: role ?? "Agent",
                    round: 3,
                    status: "hidden",
                    agentId: event.agent_id,
                    agentRole: role,
                });
                graphStore.updateNodeData(nodeId, {
                    summary: failed
                        ? "This agent response failed to generate."
                        : normalizeSummary(
                            shortSummaryHint || getTurnSummary({
                                raw: rawContent,
                                round: 3,
                                sourceRole: role,
                            }),
                            safeContent || rawContent || "Final synthesis prepared.",
                            210,
                        ),
                    content: safeContent,
                    metadata: {
                        loading: false,
                        failed,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                    },
                });
                ensureVisible(nodeId);
                get().enqueuePlaybackNode(nodeId);
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
                const graphStore = useGraphStore.getState();
                graphStore.ensureNode({
                    id: "synthesis-node",
                    kind: "synthesis",
                    label: "Synthesis",
                    round: 3,
                    status: "hidden",
                });
                graphStore.updateNodeData("synthesis-node", {
                    summary: getTurnSummary({
                        raw: summaryText,
                        round: 3,
                        kind: "synthesis",
                        maxLen: 200,
                    }),
                    content: normalizeSummary("", summaryText, 260),
                    metadata: { loading: false, failed: false, rawOutput: summaryText },
                });
                graphStore.setNodeStatus("synthesis-node", "completed");
                get().enqueuePlaybackNode("synthesis-node");
            }
        }

        // Safety: ensure question node is visible for live debates
        const g = useGraphStore.getState().graph;
        const qNode = g.nodes.find((n) => n.id === "question-node");
        if (qNode && qNode.status === "hidden") {
            useGraphStore.getState().setNodeStatus("question-node", "visible");
        }

        if (import.meta.env.DEV) {
            const after = useGraphStore.getState().graph;
            const stateAfter = get();
            // eslint-disable-next-line no-console
            console.log("[GRAPH] after canonical nodes", after.nodes.length);
            // eslint-disable-next-line no-console
            console.log("[PLAYBACK] queue after ws", stateAfter.playbackQueue.length);
            // eslint-disable-next-line no-console
            console.log("[PLAYBACK] mode", stateAfter.playbackMode);
        }

        // Forward to moderator activity feed
        useModeratorStore.getState().addActivity(event);
    },

    requestNextStep: async () => {
        const { debateId, stepBusy } = get();
        if (!debateId || stepBusy) return;
        if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[Agora][NextStep] click", { debateId, pendingStep: get().pendingStep });
        }
        set({ stepBusy: true, stepError: null });
        try {
            const res = await nextStepApi(debateId);
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug("[Agora][NextStep] response", res);
            }
            if (res.released) {
                // Gate was released — move pendingStep → currentlyGenerating
                const pending = get().pendingStep;
                set({
                    executionMode: res.execution_mode,
                    currentlyGenerating: pending ?? res.pending_step,
                    pendingStep: null,
                });
            } else {
                // Not released yet (not_ready or already running) — keep
                // pending state as-is; backend will emit agent_started later.
                set({ executionMode: res.execution_mode });
            }
        } catch (err) {
            // Never set global `error` here — that shows the full error screen.
            // Use a transient stepError shown inline in the button.
            const msg = err instanceof Error ? err.message : "Next step failed";
            set({ stepError: msg });
        } finally {
            set({ stepBusy: false });
        }
    },

    enableAutoRun: async () => {
        const { debateId } = get();
        if (!debateId) return;
        try {
            await switchToAutoRunApi(debateId);
            set({ executionMode: "auto" });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to enable auto run";
            set({ error: msg });
        }
    },

    submitFollowUp: async (question: string) => {
        const { debateId, turnId, turnStatus } = get();
        if (!debateId || !turnId) return;
        const trimmed = question.trim();
        if (!trimmed) return;
        if (turnStatus !== "completed") return;
        set({ stepBusy: true, stepError: null });
        try {
            const res = await postFollowUp(debateId, trimmed);
            // Re-attach WS to the same turn (it was closed when turn completed)
            debateWs.disconnect();
            debateWs.connect(res.turn_id);
            debateWs.subscribe(get().handleWsEvent);
            set({
                turnStatus: "queued",
                wsConnected: true,
                playbackMode: "auto",
                openedAsCompleted: false,
                staleQueuedPolls: 0,
            });
            // Refresh detail in background to pull new follow-up record
            void get().loadDebate(debateId, { silent: true });
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to start follow-up";
            set({ stepError: msg });
        } finally {
            set({ stepBusy: false });
        }
    },

    syncStepState: async () => {
        const { debateId, currentlyGenerating, staleQueuedPolls } = get();
        if (!debateId) return;
        try {
            const snap = await getStepState(debateId);
            // Don't overwrite live "currentlyGenerating" — that's a tighter
            // signal coming from message_created / agent_started events.
            const next: Partial<DebateStore> = {
                executionMode: snap.execution_mode,
                turnStatus: snap.status,
            };

            const stalledQueuedManual =
                snap.status === "queued"
                && snap.execution_mode === "manual"
                && !snap.is_running
                && snap.pending_step === null;

            if (snap.is_running) {
                if (!currentlyGenerating && snap.pending_step) {
                    next.currentlyGenerating = snap.pending_step;
                }
                next.pendingStep = null;
            } else {
                next.pendingStep = snap.pending_step;
                if (snap.pending_step) {
                    next.currentlyGenerating = null;
                    next.stepError = null;
                }
            }

            if (stalledQueuedManual) {
                const polls = staleQueuedPolls + 1;
                next.staleQueuedPolls = polls;

                // Every ~14s (8 polls x 1.8s), attempt to recover a stalled
                // queued turn by requeueing background execution.
                if (polls % 8 === 0) {
                    const resumed = await resumeDebate(debateId);
                    if (resumed.resumed) {
                        next.staleQueuedPolls = 0;
                        next.stepError = null;
                    } else if (resumed.reason && resumed.reason !== "warming_up") {
                        next.stepError = "Execution is delayed. Try Next Step or Auto Run.";
                    }
                }
            } else {
                next.staleQueuedPolls = 0;
            }

            set(next as DebateStore);
        } catch {
            /* snapshot is best-effort; ignore transient errors */
        }
    },

    setPlaybackMode: (mode) => {
        if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[PLAYBACK] mode", mode);
        }
        set((s) => (s.playbackMode === mode ? s : { playbackMode: mode }));
    },

    enqueuePlaybackNode: (nodeId) => {
        if (!nodeId || nodeId === "question-node") return;
        set((s) => {
            if (s.revealedNodeIds.includes(nodeId)) return s;
            if (s.playbackQueue.some((item) => item.id === nodeId)) return s;
            return { playbackQueue: [...s.playbackQueue, { type: "node", id: nodeId }] };
        });
    },

    syncPlaybackFromCanonical: ({
        canonicalNodeIds,
        canonicalEdges,
        isLiveExecution,
        revealAll,
    }) => {
        set((s) => {
            const canonicalEdgeIds = canonicalEdges.map((edge) => edge.id);
            const canonicalNodeSet = new Set(canonicalNodeIds);
            const canonicalEdgeSet = new Set(canonicalEdgeIds);

            let revealedNodeIds = s.revealedNodeIds.filter((id) => canonicalNodeSet.has(id));
            let revealedEdgeIds = s.revealedEdgeIds.filter((id) => canonicalEdgeSet.has(id));

            // Keep question node visible as soon as it exists.
            if (canonicalNodeSet.has("question-node") && !revealedNodeIds.includes("question-node")) {
                revealedNodeIds = ["question-node", ...revealedNodeIds];
            }

            // Edge visibility is derived from revealed endpoints; edges are not
            // standalone playback steps.
            revealedEdgeIds = deriveRevealedEdgeIds(canonicalEdges, revealedNodeIds);

            if (revealAll && !isLiveExecution) {
                const allNodeIds = [...canonicalNodeIds];
                const allEdgeIds = deriveRevealedEdgeIds(canonicalEdges, allNodeIds);

                const unchanged =
                    s.canonicalNodeCount === canonicalNodeIds.length
                    && s.canonicalEdgeCount === canonicalEdgeIds.length
                    && s.playbackQueue.length === 0
                    && arraysEqual(s.revealedNodeIds, allNodeIds)
                    && arraysEqual(s.revealedEdgeIds, allEdgeIds);

                if (unchanged) return s;

                return {
                    canonicalNodeCount: canonicalNodeIds.length,
                    canonicalEdgeCount: canonicalEdgeIds.length,
                    playbackQueue: [],
                    revealedNodeIds: allNodeIds,
                    revealedEdgeIds: allEdgeIds,
                };
            }

            const revealedNodeSet = new Set(revealedNodeIds);

            // Queue tracks response nodes only (not edges).
            const queue = s.playbackQueue.filter((item) => {
                return canonicalNodeSet.has(item.id) && !revealedNodeSet.has(item.id);
            });

            const queuedKeys = new Set(queue.map((item) => item.id));

            for (const nodeId of canonicalNodeIds) {
                if (nodeId === "question-node") continue;
                if (revealedNodeSet.has(nodeId)) continue;
                const key = nodeId;
                if (!queuedKeys.has(key)) {
                    queue.push({ type: "node", id: nodeId });
                    queuedKeys.add(key);
                }
            }

            const unchanged =
                s.canonicalNodeCount === canonicalNodeIds.length
                && s.canonicalEdgeCount === canonicalEdgeIds.length
                && arraysEqual(s.revealedNodeIds, revealedNodeIds)
                && arraysEqual(s.revealedEdgeIds, revealedEdgeIds)
                && queuesEqual(s.playbackQueue, queue);

            if (unchanged) return s;

            return {
                canonicalNodeCount: canonicalNodeIds.length,
                canonicalEdgeCount: canonicalEdgeIds.length,
                playbackQueue: queue,
                revealedNodeIds,
                revealedEdgeIds,
            };
        });
    },

    revealNextVisual: () => {
        set((s) => {
            if (s.playbackQueue.length === 0) return s;

            const [next, ...rest] = s.playbackQueue;
            const nextRevealedNodeIds = s.revealedNodeIds.includes(next.id)
                ? s.revealedNodeIds
                : [...s.revealedNodeIds, next.id];

            const canonicalEdges = useGraphStore
                .getState()
                .graph
                .edges
                .filter((edge) => edge.status !== "hidden")
                .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));

            return {
                playbackQueue: rest,
                revealedNodeIds: nextRevealedNodeIds,
                revealedEdgeIds: deriveRevealedEdgeIds(canonicalEdges, nextRevealedNodeIds),
            };
        });
    },

    setRenderedCounts: (nodes, edges) => {
        set((s) => {
            if (s.renderedNodeCount === nodes && s.renderedEdgeCount === edges) {
                return s;
            }
            return { renderedNodeCount: nodes, renderedEdgeCount: edges };
        });
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
            executionMode: "auto",
            currentlyGenerating: null,
            pendingStep: null,
            stepBusy: false,
            stepError: null,
            staleQueuedPolls: 0,
            playbackMode: "paused",
            openedAsCompleted: false,
            playbackQueue: [],
            revealedNodeIds: [],
            revealedEdgeIds: [],
            canonicalNodeCount: 0,
            canonicalEdgeCount: 0,
            renderedNodeCount: 0,
            renderedEdgeCount: 0,
            lastWsEventType: null,
        });
        useGraphStore.getState().reset();
        useModeratorStore.getState().reset();
        usePlaybackStore.getState().reset();
        useAnimationStore.getState().reset();
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────

function arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function deriveRevealedEdgeIds(canonicalEdges: CanonicalEdgeRef[], revealedNodeIds: string[]): string[] {
    const revealedNodeSet = new Set(revealedNodeIds);
    return canonicalEdges
        .filter((edge) => revealedNodeSet.has(edge.source) && revealedNodeSet.has(edge.target))
        .map((edge) => edge.id);
}

function queuesEqual(a: PlaybackQueueItem[], b: PlaybackQueueItem[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].type !== b[i].type || a[i].id !== b[i].id) return false;
    }
    return true;
}

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
