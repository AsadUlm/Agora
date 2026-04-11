import { useCallback, useEffect, useRef, useState } from "react";
import { startDebate, buildWsUrl } from "../services/debateService";
import type {
    AgentInput,
    DebateStartResponse,
    DebateStatus,
    LiveMessage,
    WsEvent,
} from "../types/debate";

interface UseDebateReturn {
    status: DebateStatus;
    debateInfo: DebateStartResponse | null;
    messages: LiveMessage[];
    currentRound: number;
    error: string | null;
    start: (question: string, agents: AgentInput[]) => Promise<void>;
    reset: () => void;
}

export function useDebate(): UseDebateReturn {
    const [status, setStatus] = useState<DebateStatus>("idle");
    const [debateInfo, setDebateInfo] = useState<DebateStartResponse | null>(null);
    const [messages, setMessages] = useState<LiveMessage[]>([]);
    const [currentRound, setCurrentRound] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);

    // Cleanup WebSocket on unmount
    useEffect(() => {
        return () => {
            wsRef.current?.close();
        };
    }, []);

    const connectWs = useCallback((wsPath: string) => {
        const url = buildWsUrl(wsPath);
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("[WS] connected");
        };

        ws.onmessage = (e) => {
            let event: WsEvent;
            try {
                event = JSON.parse(e.data);
            } catch {
                return;
            }

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
                    const rawContent = (payload.content as string) ?? "";

                    // Try to parse JSON from LLM content
                    let parsedPayload = null;
                    try {
                        parsedPayload = JSON.parse(rawContent);
                    } catch {
                        // content is plain text — keep parsedPayload null
                    }

                    const msg: LiveMessage = {
                        id: (payload.message_id as string) ?? Math.random().toString(),
                        agentId: event.agent_id,
                        roundNumber: event.round_number ?? currentRound,
                        messageType: (payload.message_type as string) ?? "agent_response",
                        content: rawContent,
                        parsedPayload,
                        sequenceNo: (payload.sequence_no as number) ?? 0,
                    };

                    setMessages((prev) => [...prev, msg]);
                    break;
                }

                case "round_completed":
                    break;

                case "turn_completed":
                    setStatus("completed");
                    ws.close();
                    break;

                case "turn_failed":
                    setStatus("failed");
                    setError((event.payload.error as string) ?? "Debate failed");
                    ws.close();
                    break;
            }
        };

        ws.onerror = () => {
            setStatus("failed");
            setError("WebSocket connection error");
        };

        ws.onclose = () => {
            console.log("[WS] disconnected");
        };
    }, [currentRound]);

    const start = useCallback(async (question: string, agents: AgentInput[]) => {
        setStatus("queued");
        setMessages([]);
        setCurrentRound(0);
        setError(null);
        setDebateInfo(null);

        try {
            const info = await startDebate({ question, agents });
            setDebateInfo(info);
            connectWs(info.ws_turn_url);
        } catch (err: unknown) {
            setStatus("failed");
            setError(err instanceof Error ? err.message : "Failed to start debate");
        }
    }, [connectWs]);

    const reset = useCallback(() => {
        wsRef.current?.close();
        setStatus("idle");
        setDebateInfo(null);
        setMessages([]);
        setCurrentRound(0);
        setError(null);
    }, []);

    return { status, debateInfo, messages, currentRound, error, start, reset };
}
