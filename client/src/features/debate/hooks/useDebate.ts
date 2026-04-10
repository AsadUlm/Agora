import { useCallback, useEffect, useState } from "react";
import type { AxiosError } from "axios";
import { startDebate, getDebate } from "../../../services/debateService";
import type { AgentCreateRequest } from "../../../types/debate";
import type {
    ConnectionStatus,
    DebatePhase,
    DebateRuntime,
    LiveMessage,
    LiveRound,
    WsEvent,
} from "../../../types/ws";
import { useDebateWebSocket } from "./useDebateWebSocket";

// ── Agent draft — mutable form state for one agent ────────────────────

export interface AgentDraft {
    localId: string;
    role: string;
    model: string;          // e.g. "llama-3.3-70b-versatile"
    temperature: number;    // 0.0 – 1.0
    reasoningStyle: string; // balanced | analytical | creative | devil_advocate
}

const DEFAULT_AGENTS: AgentDraft[] = [
    { localId: "agent-1", role: "Proponent", model: "llama-3.3-70b-versatile", temperature: 0.7, reasoningStyle: "balanced" },
    { localId: "agent-2", role: "Critic", model: "llama-3.3-70b-versatile", temperature: 0.7, reasoningStyle: "analytical" },
];

// ── Error extraction ──────────────────────────────────────────────────

function extractApiError(err: unknown): string {
    const axiosErr = err as AxiosError<{ detail?: string }>;
    const detail = axiosErr.response?.data?.detail;
    if (detail) return String(detail);
    if (axiosErr instanceof Error) return axiosErr.message;
    return "An unexpected error occurred. Please try again.";
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useDebate() {
    // ── Form state ────────────────────────────────────────────────────
    const [question, setQuestion] = useState("");
    const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);

    // ── Lifecycle ─────────────────────────────────────────────────────
    const [phase, setPhase] = useState<DebatePhase>("idle");
    const [submitError, setSubmitError] = useState<string | null>(null);

    // ── Live debate state ─────────────────────────────────────────────
    const [runtime, setRuntime] = useState<DebateRuntime | null>(null);

    // ── WS URL — null means "don't connect" ───────────────────────────
    const [wsUrl, setWsUrl] = useState<string | null>(null);

    // ── WS event handler ──────────────────────────────────────────────
    const handleWsEvent = useCallback((event: WsEvent) => {
        switch (event.type) {
            case "turn_started":
                setPhase((p) => (p === "starting" ? "live" : p));
                setRuntime((prev) =>
                    prev ? { ...prev, connectionStatus: "connected" } : prev,
                );
                break;

            case "round_started": {
                const roundNumber = event.round_number ?? 0;
                const newRound: LiveRound = {
                    roundNumber,
                    roundId: event.round_id,
                    status: "running",
                    messages: [],
                };
                setRuntime((prev) => {
                    if (!prev) return prev;
                    const exists = prev.rounds.some(
                        (r) => r.roundNumber === roundNumber,
                    );
                    if (exists) return prev;
                    const rounds = [...prev.rounds, newRound].sort(
                        (a, b) => a.roundNumber - b.roundNumber,
                    );
                    return { ...prev, rounds };
                });
                break;
            }

            case "message_created": {
                const roundNumber = event.round_number ?? 0;
                const { payload } = event;
                const agentId = event.agent_id ?? "";
                const draft: LiveMessage = {
                    messageId: String(payload.message_id ?? ""),
                    agentId,
                    role: "", // resolved inside setRuntime
                    roundNumber,
                    messageType: String(payload.message_type ?? ""),
                    content: String(payload.content ?? ""),
                    generationStatus: String(payload.generation_status ?? "success"),
                };
                setRuntime((prev) => {
                    if (!prev) return prev;
                    const msg: LiveMessage = {
                        ...draft,
                        role: prev.agentMap[agentId] ?? "Agent",
                    };
                    // Guard: auto-create the round when round_started was missed
                    // (it fires before the WS connection is established for Round 1).
                    const roundExists = prev.rounds.some(
                        (r) => r.roundNumber === roundNumber,
                    );
                    if (!roundExists) {
                        const newRound: LiveRound = {
                            roundNumber,
                            roundId: event.round_id,
                            status: "running",
                            messages: [msg],
                        };
                        const rounds = [...prev.rounds, newRound].sort(
                            (a, b) => a.roundNumber - b.roundNumber,
                        );
                        return { ...prev, rounds };
                    }
                    const rounds = prev.rounds.map((r) => {
                        if (r.roundNumber !== roundNumber) return r;
                        const dup = r.messages.some((m) => m.messageId === msg.messageId);
                        if (dup) return r;
                        return { ...r, messages: [...r.messages, msg] };
                    });
                    return { ...prev, rounds };
                });
                break;
            }

            case "round_completed": {
                const roundNumber = event.round_number ?? 0;
                setRuntime((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        rounds: prev.rounds.map((r) =>
                            r.roundNumber === roundNumber
                                ? { ...r, status: "completed" }
                                : r,
                        ),
                    };
                });
                break;
            }

            case "turn_completed":
                setPhase("completed");
                setWsUrl(null);
                break;

            case "turn_failed":
                setPhase("failed");
                setWsUrl(null);
                setRuntime((prev) =>
                    prev
                        ? {
                            ...prev,
                            error: String(
                                event.payload.error ?? "Debate execution failed.",
                            ),
                        }
                        : prev,
                );
                break;
        }
    }, []);

    const handleConnectionStatus = useCallback((status: ConnectionStatus) => {
        setRuntime((prev) =>
            prev ? { ...prev, connectionStatus: status } : prev,
        );
    }, []);

    useDebateWebSocket({
        url: wsUrl,
        onEvent: handleWsEvent,
        onStatusChange: handleConnectionStatus,
    });

    // ── Reconciliation: fill any rounds missed during WS connection window ─────
    // When the debate completes, fetch the final snapshot from the API and add
    // any rounds (e.g. Round 1) that never appeared in the live stream because
    // their events fired before the WebSocket connection was established.
    useEffect(() => {
        if (phase !== "completed" || !runtime?.debateId) return;
        const debateId = runtime.debateId;

        getDebate(debateId)
            .then((detail) => {
                if (!detail.rounds?.length) return;
                setRuntime((prev) => {
                    if (!prev) return prev;
                    const liveNums = new Set(prev.rounds.map((r) => r.roundNumber));
                    const missing: LiveRound[] = detail.rounds
                        .filter((dr) => !liveNums.has(dr.round_number))
                        .map((dr) => ({
                            roundNumber: dr.round_number,
                            roundId: dr.id,
                            status: "completed" as const,
                            messages: dr.data.map((entry, i) => ({
                                messageId: `${dr.id}-reconciled-${i}`,
                                agentId: entry.agent_id,
                                role: prev.agentMap[entry.agent_id] ?? "Agent",
                                roundNumber: dr.round_number,
                                messageType: entry.message_type,
                                content: JSON.stringify(entry.data),
                                generationStatus: "success",
                            })),
                        }));
                    if (missing.length === 0) return prev;
                    const rounds = [...prev.rounds, ...missing].sort(
                        (a, b) => a.roundNumber - b.roundNumber,
                    );
                    return { ...prev, rounds };
                });
            })
            .catch(() => {
                // Non-fatal — live state is used as-is
            });
    }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
    // ^ Intentional: we want the snapshot captured when phase changes to
    //   "completed", not re-fetched every time runtime updates.

    // ── Form helpers ──────────────────────────────────────────────────
    const addAgent = useCallback(() => {
        setAgents((prev) => [
            ...prev,
            { localId: `agent-${Date.now()}`, role: "", model: "llama-3.3-70b-versatile", temperature: 0.7, reasoningStyle: "balanced" },
        ]);
    }, []);

    const updateAgent = useCallback(
        (localId: string, patch: Partial<Omit<AgentDraft, "localId">>) => {
            setAgents((prev) =>
                prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)),
            );
        },
        [],
    );

    const removeAgent = useCallback((localId: string) => {
        setAgents((prev) => prev.filter((a) => a.localId !== localId));
    }, []);

    const clearError = useCallback(() => setSubmitError(null), []);

    // ── Submit ────────────────────────────────────────────────────────
    const submit = useCallback(async () => {
        setSubmitError(null);
        setPhase("starting");

        const agentRequests: AgentCreateRequest[] = agents.map((a) => ({
            role: a.role.trim(),
            config: {
                model: {
                    provider: "groq",
                    model: a.model,
                    temperature: a.temperature,
                },
                reasoning: {
                    style: a.reasoningStyle,
                },
            },
        }));

        try {
            const startResp = await startDebate({
                question: question.trim(),
                agents: agentRequests,
            });

            // ── Connect the WebSocket IMMEDIATELY after the POST returns. ─────
            // FastAPI's BackgroundTasks fires the debate engine right after the
            // HTTP response is sent, so round_started / message_created for
            // Round 1 can arrive within ~50 ms. Any extra await here (e.g. the
            // agent-map GET) delays WS connection enough to miss those events.
            setRuntime({
                debateId: startResp.debate_id,
                turnId: startResp.turn_id,
                question: startResp.question,
                agentMap: {},   // populated below once the GET resolves
                rounds: [],
                connectionStatus: "connecting",
                error: null,
            });
            setWsUrl(startResp.ws_turn_url);

            // ── Hydrate agent map concurrently with the WS handshake. ─────────
            // This is non-fatal: if the GET fails, agent roles fall back to
            // "Agent" for the duration of the debate.
            try {
                const detail = await getDebate(startResp.debate_id);
                const agentMap: Record<string, string> = {};
                for (const agent of detail.agents) {
                    agentMap[agent.id] = agent.role;
                }
                setRuntime((prev) => (prev ? { ...prev, agentMap } : prev));
            } catch {
                // non-fatal — agentMap stays empty, roles display as "Agent"
            }
        } catch (err) {
            const msg = extractApiError(err);
            setSubmitError(msg);
            setPhase("idle");
            setRuntime(null);
            setWsUrl(null);
        }
    }, [question, agents]);

    // ── Reset ─────────────────────────────────────────────────────────
    const reset = useCallback(() => {
        setWsUrl(null);
        setRuntime(null);
        setPhase("idle");
        setSubmitError(null);
        setQuestion("");
        setAgents(DEFAULT_AGENTS);
    }, []);

    return {
        // Form
        question,
        setQuestion,
        agents,
        addAgent,
        updateAgent,
        removeAgent,
        // Lifecycle
        phase,
        submitError,
        clearError,
        submit,
        // Live state
        runtime,
        reset,
    };
}
