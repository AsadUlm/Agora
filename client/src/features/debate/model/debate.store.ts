import { create } from "zustand";
import type {
    AgentDTO,
    DebateStartResponse,
    GenerationErrorMetadata,
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
import { debateWs, type StreamStatus } from "../api/debate.ws";
import { useGraphStore } from "./graph.store";
import { useModeratorStore } from "./moderator.store";
import { usePlaybackStore } from "./playback.store";
import { useAnimationStore } from "./animation/animation.store";
import { formatRound1Summary, formatRound2Summary, getTurnSummary, normalizeSummary } from "./formatters";
import { shouldSkipGraphInference } from "./error-normalizer";

/**
 * Extract a human-readable message from an API error, preferring the backend's
 * FastAPI ``detail`` field (e.g. the 409 "A debate cycle is already in
 * progress" message) over the generic axios "Request failed…" text.
 */
function extractApiErrorMessage(err: unknown, fallback: string): string {
    const detail = (
        err as { response?: { data?: { detail?: unknown } } }
    )?.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (err instanceof Error && err.message) return err.message;
    return fallback;
}

export interface GenerationError {
    code: string;
    message: string;
    userMessage: string;
    retryable: boolean;
    provider?: string | null;
    model?: string | null;
    statusCode?: number | null;
    roundNumber?: number | null;
    roundType?: string | null;
    timestamp?: string;
    severity: "fatal" | "recoverable" | "partial";
    phase?: string | null;
    failedAgents: string[];
    successfulAgents: string[];
    partialResultsAvailable: boolean;
    requestId?: string | null;
    lastSuccessfulStage?: number | null;
}

function toGenerationError(error: GenerationErrorMetadata | null | undefined): GenerationError | null {
    if (!error) return null;
    return {
        code: error.code,
        message: error.message,
        userMessage: error.user_message ?? error.message,
        retryable: error.retryable,
        severity: error.severity ?? "fatal",
        phase: error.phase ?? null,
        failedAgents: error.failed_agents ?? [],
        successfulAgents: error.successful_agents ?? [],
        partialResultsAvailable: error.partial_results_available ?? false,
        requestId: error.request_id ?? null,
        lastSuccessfulStage: error.last_successful_stage ?? null,
        provider: error.provider,
        model: error.model,
        statusCode: error.status_code,
        roundNumber: error.round_number,
        roundType: error.round_type,
        timestamp: error.timestamp,
    };
}

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
    /** Load error — set when the debate cannot be loaded at all (404, 500, network). */
    error: string | null;
    /**
     * Generation error — set when the debate loaded but generation failed.
     * This does NOT trigger a full-page error; the debate page stays loaded
     * and shows a controlled error banner/panel instead.
     */
    generationError: GenerationError | null;
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
    lastWsEventTimestamp: string | null;
    streamStatus: StreamStatus;
    streamReconciliationAttempted: boolean;
    /**
     * FIX-12: Whether retrieval-augmented generation is active for the
     * current turn. ``null`` means the backend has not yet reported, ``false``
     * is a normal state (reasoning-only mode) — never an error.
     */
    ragActive: boolean | null;
    documentCount: number;
    /** Position-index → color key, set when a debate is started from the form. */
    agentColorsByPosition: Record<number, string>;

    startDebate: (
        question: string,
        agents: { role: string; config: Record<string, unknown> }[],
        executionMode?: "auto" | "manual",
        options?: { sessionId?: string },
    ) => Promise<DebateStartResponse>;
    loadDebate: (debateId: string, options?: { silent?: boolean }) => Promise<void>;
    handleWsEvent: (event: WsEvent) => void;
    handleStreamStatus: (status: StreamStatus) => void;
    requestNextStep: () => Promise<void>;
    enableAutoRun: () => Promise<void>;
    submitFollowUp: (question: string) => Promise<void>;
    syncStepState: () => Promise<void>;
    reset: () => void;

    /** Store agent colors by position (frontend-only, set from AgentConfig before start). */
    setAgentColors: (colors: Record<number, string>) => void;

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
    generationError: null,
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
    lastWsEventTimestamp: null,
    streamStatus: "disconnected",
    streamReconciliationAttempted: false,
    ragActive: null,
    documentCount: 0,
    agentColorsByPosition: {},

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
                lastWsEventTimestamp: null,
                streamStatus: "connecting",
                streamReconciliationAttempted: false,
            });

            // Connect WebSocket
            debateWs.disconnect();
            debateWs.connect(response.turn_id);
            debateWs.subscribe(get().handleWsEvent);
            debateWs.subscribeStatus(get().handleStreamStatus);
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
            set({ loading: true, error: null, generationError: null });
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
                generationError: toGenerationError(turn?.error),
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
                        lastWsEventTimestamp: null,
                        streamReconciliationAttempted: false,
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
                    debateWs.subscribeStatus(get().handleStreamStatus);
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
            // This is a LOAD error (network, 404, 500) — not a generation error.
            // Only set the full-page `error` when loading itself fails.
            const status = (err as { response?: { status?: number } })?.response?.status;
            const isNotFound = status === 404;
            const msg = isNotFound
                ? "Debate not found."
                : err instanceof Error ? err.message : "Failed to load debate";
            if (!silent) {
                set({ error: msg, loading: false });
            } else {
                if (import.meta.env.DEV) {
                    console.warn("[Agora] Silent debate refresh failed:", msg);
                }
            }
        }
    },

    handleWsEvent: (event) => {
        const state = get();
        set({ lastWsEventType: event.type, lastWsEventTimestamp: event.timestamp });

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
            case "turn_started": {
                // FIX-12: hydrate RAG mode flags from the backend so the UI
                // can render a neutral indicator. Reasoning-only is normal.
                const payload = event.payload ?? {};
                const ragActive = typeof payload.rag_active === "boolean"
                    ? payload.rag_active
                    : null;
                const documentCount = typeof payload.document_count === "number"
                    ? payload.document_count
                    : 0;
                set({
                    turnStatus: "running",
                    ragActive,
                    documentCount,
                    // Clear any previous generation error when a new turn starts
                    generationError: null,
                    stepBusy: false,
                    currentlyGenerating: null,
                    pendingStep: null,
                });
                break;
            }

            case "round_started":
                // Stale event protection: if the turn is already completed, a stale
                // round_started from the same turn must not regress state to running.
                if (
                    state.turnStatus === "completed"
                    || state.turnStatus === "partially_completed"
                    || state.turnStatus === "failed"
                ) {
                    if (import.meta.env.DEV) {
                        console.debug("[Debate UI] Ignoring stale round_started after terminal state", {
                            turnStatus: state.turnStatus,
                            roundNumber: event.round_number,
                        });
                    }
                    break;
                }
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
                set({
                    turnStatus: "completed",
                    stepBusy: false,
                    currentlyGenerating: null,
                    pendingStep: null,
                });
                // Reload full session once to capture final summary/synthesis.
                if (state.debateId) {
                    getDebateDetail(state.debateId).then((session) => {
                        const turn = session.latest_turn;
                        // Never regress from "completed" to "running" via a stale API response.
                        // The turn_completed WS event is the authoritative completion signal;
                        // the REST snapshot may lag behind by a few milliseconds.
                        const safeTurnStatus =
                            turn?.status === "running" || turn?.status === "queued"
                                ? "completed"
                                : (turn?.status ?? "completed");
                        set({
                            session,
                            agents: session.agents ?? [],
                            turnStatus: safeTurnStatus,
                            currentRound: turn?.current_stage ?? 5,
                            generationError: toGenerationError(turn?.error),
                            stepBusy: false,
                            currentlyGenerating: null,
                            pendingStep: null,
                        });
                        useGraphStore.getState().mergeFromSession(session);
                        useModeratorStore.getState().updateFromSession(session, turn?.current_stage ?? 5);
                        if (import.meta.env.DEV) {
                            console.debug("[Debate UI] turn completed", {
                                debateId: state.debateId,
                                turnId: turn?.id,
                                fetchedStatus: turn?.status,
                                appliedStatus: safeTurnStatus,
                            });
                        }
                    }).catch(() => {
                        // API refresh failed — keep the completed state we already set
                    });
                }
                break;

            case "turn_partially_completed": {
                const safeError = event.payload["safe_error"] as GenerationErrorMetadata | undefined;
                set({
                    turnStatus: "partially_completed",
                    generationError: toGenerationError(safeError),
                    stepBusy: false,
                    currentlyGenerating: null,
                    pendingStep: null,
                });
                if (state.debateId) {
                    void get().loadDebate(state.debateId, { silent: true });
                }
                break;
            }

            case "turn_failed": {
                // Build a safe generation error — never use raw error string for full-page crash.
                // The debate page must remain loaded; we show a controlled banner instead.
                const p = event.payload ?? {};
                const safeErrorPayload = p["safe_error"] as Record<string, unknown> | undefined;
                const generationErr: GenerationError = safeErrorPayload
                    ? {
                        code: String(safeErrorPayload["code"] ?? "UNKNOWN_ERROR"),
                        message: String(safeErrorPayload["message"] ?? "Debate generation failed"),
                        userMessage: String(
                            safeErrorPayload["user_message"] ??
                            "The debate generation failed. Please check your API key and retry."
                        ),
                        retryable: Boolean(safeErrorPayload["retryable"] ?? true),
                        severity: String(safeErrorPayload["severity"] ?? "fatal") as GenerationError["severity"],
                        phase: (safeErrorPayload["phase"] as string) ?? null,
                        failedAgents: (safeErrorPayload["failed_agents"] as string[]) ?? [],
                        successfulAgents: (safeErrorPayload["successful_agents"] as string[]) ?? [],
                        partialResultsAvailable: Boolean(safeErrorPayload["partial_results_available"] ?? false),
                        requestId: (safeErrorPayload["request_id"] as string) ?? null,
                        lastSuccessfulStage: (safeErrorPayload["last_successful_stage"] as number) ?? null,
                        provider: (safeErrorPayload["provider"] as string) ?? null,
                        model: (safeErrorPayload["model"] as string) ?? null,
                        statusCode: (safeErrorPayload["status_code"] as number) ?? null,
                        roundNumber: (safeErrorPayload["round_number"] as number) ?? null,
                        roundType: (safeErrorPayload["round_type"] as string) ?? null,
                        timestamp: (safeErrorPayload["timestamp"] as string) ?? undefined,
                    }
                    : {
                        code: "UNKNOWN_ERROR",
                        message: typeof p["error"] === "string"
                            ? (p["error"] as string)
                            : "Debate generation failed",
                        userMessage: "The debate generation failed. Please check your API key or model selection and retry.",
                        retryable: true,
                        severity: "fatal",
                        failedAgents: [],
                        successfulAgents: [],
                        partialResultsAvailable: false,
                    };
                const confirmedStatus =
                    generationErr.partialResultsAvailable || generationErr.severity === "partial"
                        ? "partially_completed"
                        : "failed";
                set({
                    turnStatus: confirmedStatus,
                    currentlyGenerating: null,
                    pendingStep: null,
                    // CRITICAL: set generationError, NOT error, so the debate page stays loaded.
                    generationError: generationErr,
                });
                if (confirmedStatus === "failed") {
                    useGraphStore.getState().markRunningNodesFailed();
                }
                if (import.meta.env.DEV) {
                    console.debug("[Debate UI] turn_failed", {
                        debateId: event.session_id,
                        code: generationErr.code,
                        retryable: generationErr.retryable,
                    });
                }
                break;
            }

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

            case "round_failed": {
                // A round failed — keep the debate page loaded; show error in moderator/UI.
                // generationError already gets set when turn_failed arrives; this just logs.
                const rfPayload = event.payload ?? {};
                const rfError = rfPayload["error"] as Record<string, unknown> | undefined;
                if (import.meta.env.DEV) {
                    console.debug("[Debate UI] round_failed", {
                        debateId: event.session_id,
                        roundNumber: rfPayload["round_number"],
                        code: rfError?.["code"],
                    });
                }
                // If we only have round_failed (no turn_failed yet), set generationError so
                // the UI can show an informational banner even before the turn resolves.
                if (!get().generationError && rfError) {
                    set({
                        generationError: {
                            code: String(rfError["code"] ?? "ROUND_ALL_AGENTS_FAILED"),
                            message: String(rfError["message"] ?? "Round failed"),
                            userMessage: String(
                                rfError["user_message"] ??
                                "A debate round failed. Please check your API key or model selection and retry."
                            ),
                            retryable: Boolean(rfError["retryable"] ?? true),
                            severity: String(rfError["severity"] ?? "fatal") as GenerationError["severity"],
                            phase: (rfError["phase"] as string) ?? null,
                            failedAgents: (rfError["failed_agents"] as string[]) ?? [],
                            successfulAgents: (rfError["successful_agents"] as string[]) ?? [],
                            partialResultsAvailable: Boolean(rfError["partial_results_available"] ?? false),
                            requestId: (rfError["request_id"] as string) ?? null,
                            lastSuccessfulStage: (rfError["last_successful_stage"] as number) ?? null,
                            roundNumber: typeof rfPayload["round_number"] === "number"
                                ? (rfPayload["round_number"] as number)
                                : null,
                            roundType: typeof rfPayload["round_type"] === "string"
                                ? (rfPayload["round_type"] as string)
                                : null,
                        },
                    });
                }
                break;
            }

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
            const parseStatus =
                typeof payload["parse_status"] === "string"
                    ? String(payload["parse_status"]).toLowerCase()
                    : "";
            const failureReason =
                typeof payload["failure_reason"] === "string"
                    ? String(payload["failure_reason"])
                    : "";
            // Safe error object attached by the backend for provider failures.
            const safeErrorPayload = payload["safe_error"] as Record<string, unknown> | undefined;
            const agentSafeError = safeErrorPayload
                ? {
                    code: String(safeErrorPayload["code"] ?? "UNKNOWN_ERROR"),
                    userMessage: String(
                        safeErrorPayload["user_message"] ??
                        "This agent failed to generate a response."
                    ),
                    retryable: Boolean(safeErrorPayload["retryable"] ?? true),
                    provider: (safeErrorPayload["provider"] as string | null) ?? null,
                    model: (safeErrorPayload["model"] as string | null) ?? null,
                }
                : null;
            const generationStatus =
                typeof payload["generation_status"] === "string"
                    ? String(payload["generation_status"]).toLowerCase()
                    : "success";
            // Phase 6: a fallback / fallback-parse payload is malformed output
            // and must be shown as a failed node, never as valid debate content.
            const malformed = isFallbackHint || parseStatus === "fallback";
            const failed =
                generationStatus === "failed" || malformed || skipGraphInference;
            const failMessage = agentSafeError?.userMessage
                ?? (malformed
                    ? "This model returned malformed output. Please retry this agent or choose a more stable model."
                    : "This agent response failed to generate.");

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
                        ? failMessage
                        : normalizeSummary(
                            shortSummaryHint || formatRound1Summary(rawContent),
                            safeContent || rawContent || "Initial position prepared.",
                            200,
                        ),
                    content: safeContent,
                    metadata: {
                        loading: false,
                        failed,
                        malformed,
                        failureReason,
                        safeError: agentSafeError,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                        // RAG visibility: forward the optional retrieval blob
                        // attached by the backend so the UI can render the
                        // evidence badge and source-chunk panel.
                        ...(payload["retrieval"] && typeof payload["retrieval"] === "object"
                            ? { retrieval: payload["retrieval"] }
                            : {}),
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
                        ? failMessage
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
                        malformed,
                        failureReason,
                        safeError: agentSafeError,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                        ...(payload["retrieval"] && typeof payload["retrieval"] === "object"
                            ? { retrieval: payload["retrieval"] }
                            : {}),
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
                        ? failMessage
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
                        malformed,
                        failureReason,
                        safeError: agentSafeError,
                        isFallback: isFallbackHint,
                        rawOutput: rawContent,
                        displayContent: safeContent,
                        ...(payload["retrieval"] && typeof payload["retrieval"] === "object"
                            ? { retrieval: payload["retrieval"] }
                            : {}),
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

    handleStreamStatus: (status) => {
        const state = get();
        set({
            streamStatus: status,
            wsConnected: status === "connected",
            ...(status === "connected" ? { streamReconciliationAttempted: false } : {}),
        });
        if (
            status === "interrupted"
            && !state.streamReconciliationAttempted
            && state.debateId
            && (state.turnStatus === "queued" || state.turnStatus === "running")
        ) {
            set({ streamReconciliationAttempted: true });
            void get().loadDebate(state.debateId, { silent: true });
        }
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
        if (import.meta.env.DEV) {
            console.debug("[FollowUp UI] submitting", {
                debateId,
                turnId,
                questionLength: trimmed.length,
            });
        }
        set({ stepBusy: true, stepError: null });
        try {
            const res = await postFollowUp(debateId, trimmed);
            if (import.meta.env.DEV) {
                console.debug("[FollowUp UI] response received", {
                    hasData: Boolean(res),
                    followUpId: res?.follow_up_id,
                    cycleNumber: res?.cycle_number,
                    status: res?.status,
                });
            }
            // Re-attach WS to the same turn (it was closed when turn completed)
            debateWs.disconnect();
            debateWs.connect(res.turn_id);
            debateWs.subscribe(get().handleWsEvent);
            debateWs.subscribeStatus(get().handleStreamStatus);
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
            const msg = extractApiErrorMessage(err, "Failed to start follow-up");
            if (import.meta.env.DEV) {
                console.error("[FollowUp UI] failed", err);
            }
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
            generationError: null,
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
            lastWsEventTimestamp: null,
            streamStatus: "disconnected",
            streamReconciliationAttempted: false,
            ragActive: null,
            documentCount: 0,
            agentColorsByPosition: {},
        });
        useGraphStore.getState().reset();
        useModeratorStore.getState().reset();
        usePlaybackStore.getState().reset();
        useAnimationStore.getState().reset();
    },

    setAgentColors: (colors) => set({ agentColorsByPosition: colors }),
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
