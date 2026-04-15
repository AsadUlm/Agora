import { useCallback, useEffect, useState } from "react";
import { startDebate, getDebate } from "../services/debateService";
import { useDebateWebSocket } from "./useDebateWebSocket";
import type {
    AgentCreateRequest,
    DebateStartResponse,
    DebateStatus,
} from "../types/debate";
import type { LiveMessage, WsEvent, ConnectionStatus } from "../types/ws";

interface UseDebateReturn {
    status: DebateStatus;
    debateInfo: DebateStartResponse | null;
    agentMap: Record<string, string>;
    messages: LiveMessage[];
    currentRound: number;
    error: string | null;
    connectionStatus: ConnectionStatus;
    start: (question: string, agents: AgentCreateRequest[]) => Promise<void>;
    reset: () => void;
}

export function useDebate(): UseDebateReturn {
    const [status, setStatus] = useState<DebateStatus>("idle");
    const [debateInfo, setDebateInfo] = useState<DebateStartResponse | null>(null);
    const [agentMap, setAgentMap] = useState<Record<string, string>>({});
    const [messages, setMessages] = useState<LiveMessage[]>([]);
    const [currentRound, setCurrentRound] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");

    // WS URL drives the connection — null means disconnected
    const [wsUrl, setWsUrl] = useState<string | null>(null);

    const handleWsEvent = useCallback((event: WsEvent) => {
        switch (event.type) {
            case "turn_started":
                setStatus("running");
                break;

            case "round_started":
                if (event.round_number != null) {
                    setCurrentRound(event.round_number);
                }
                break;

            case "message_created": {
                const payload = event.payload;
                let rawContent = "";
                if (typeof payload.content === "string") {
                    rawContent = payload.content;
                } else if (payload.content !== undefined && payload.content !== null) {
                    rawContent = JSON.stringify(payload.content);
                } else if (typeof payload.text === "string") {
                    rawContent = payload.text;
                }
                const msg: LiveMessage = {
                    messageId: (payload.message_id as string) ?? Math.random().toString(),
                    agentId: event.agent_id ?? "",
                    role: "", // Filled safely by HomePage using agentMap
                    roundNumber: event.round_number ?? currentRound, // use stable currentRound reference is fine here, or just trust event
                    messageType: (payload.message_type as string) ?? "agent_response",
                    content: rawContent,
                    generationStatus: (payload.generation_status as string) ?? "success",
                };

                // For robustness against stale currentRound closure, prefer the event's round number
                if (event.round_number) {
                    msg.roundNumber = event.round_number;
                }

                setMessages((prev) => [...prev, msg]);
                break;
            }

            case "turn_completed":
                setStatus("completed");
                setWsUrl(null);
                break;

            case "turn_failed":
                setStatus("failed");
                setError((event.payload.error as string) ?? "Debate failed");
                setWsUrl(null);
                break;
        }
    }, [currentRound]);

    useDebateWebSocket({
        url: wsUrl,
        onEvent: handleWsEvent,
        onStatusChange: setConnectionStatus,
    });

    // ── Reconciliation / Agent Map Fetch ────────────────────────────────
    useEffect(() => {
        if (!debateInfo?.debate_id) return;

        getDebate(debateInfo.debate_id)
            .then((detail) => {
                // Populate Agent Map
                const map: Record<string, string> = {};
                for (const agent of detail.agents) {
                    map[agent.id] = agent.role;
                }
                setAgentMap(map);

                // Reconcile missed messages if completed
                const rounds = detail.latest_turn?.rounds ?? [];
                if (status === "completed" && rounds.length > 0) {
                    const fullHistory: LiveMessage[] = [];
                    rounds.forEach((dr) => {
                        dr.messages.forEach((msg, i) => {
                            fullHistory.push({
                                messageId: msg.id ?? `${dr.id}-reconciled-${i}`,
                                agentId: msg.agent_id ?? "",
                                role: msg.agent_role ?? map[msg.agent_id ?? ""] ?? "Agent",
                                roundNumber: dr.round_number,
                                messageType: msg.message_type,
                                content: msg.text,
                                generationStatus: "success",
                            });
                        });
                    });
                    if (fullHistory.length > 0) setMessages(fullHistory);
                }
            })
            .catch(() => { });
    }, [debateInfo?.debate_id, status]);


    const start = useCallback(async (question: string, agents: AgentCreateRequest[]) => {
        setStatus("queued");
        setMessages([]);
        setCurrentRound(0);
        setError(null);
        setDebateInfo(null);
        setAgentMap({});

        try {
            const info = await startDebate({ question, agents });
            setDebateInfo(info);
            setWsUrl(info.ws_turn_url); // triggers connection
        } catch (err: unknown) {
            setStatus("failed");
            setError(err instanceof Error ? err.message : "Failed to start debate");
        }
    }, []);

    const reset = useCallback(() => {
        setWsUrl(null);
        setStatus("idle");
        setDebateInfo(null);
        setAgentMap({});
        setMessages([]);
        setCurrentRound(0);
        setError(null);
    }, []);

    return {
        status,
        debateInfo,
        agentMap,
        messages,
        currentRound,
        error,
        connectionStatus,
        start,
        reset
    };
}
