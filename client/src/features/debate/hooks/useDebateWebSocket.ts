import { useEffect, useRef } from "react";
import type { WsEvent, ConnectionStatus } from "../../../types/ws";

// ── Build WebSocket base URL from the HTTP API base URL ───────────────

function getWsBase(): string {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
    return base.replace(/^https?/, (scheme: string) => (scheme === "https" ? "wss" : "ws"));
}

// ── Hook ──────────────────────────────────────────────────────────────

interface Options {
    /** Relative path, e.g. "/ws/chat-turns/{id}". null = don't connect. */
    url: string | null;
    onEvent: (event: WsEvent) => void;
    onStatusChange: (status: ConnectionStatus) => void;
    /** Max reconnect attempts on unexpected disconnect. Default: 2 */
    maxReconnects?: number;
}

/**
 * Manages a single WebSocket connection lifecycle.
 *
 * - Connects when `url` becomes non-null, disconnects when `url` becomes null.
 * - JWT is read from localStorage at connect time (same key as the axios interceptor).
 * - On unexpected disconnect, retries up to `maxReconnects` times (2s delay).
 * - Stops reconnecting once turn_completed or turn_failed is received.
 * - Callbacks (onEvent, onStatusChange) are stabilised via refs — changing them
 *   does NOT trigger a reconnect.
 */
export function useDebateWebSocket({
    url,
    onEvent,
    onStatusChange,
    maxReconnects = 2,
}: Options): void {
    // Stabilise callbacks so changing them doesn't trigger reconnects
    const onEventRef = useRef(onEvent);
    const onStatusChangeRef = useRef(onStatusChange);
    useEffect(() => {
        onEventRef.current = onEvent;
    });
    useEffect(() => {
        onStatusChangeRef.current = onStatusChange;
    });

    useEffect(() => {
        if (!url) return;

        let destroyed = false;
        let wsInstance: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectCount = 0;
        // Set to true when the debate has finished — no reconnect needed
        let debateDone = false;

        function doConnect() {
            if (destroyed) return;

            // Read token at connect time so we always use the freshest value
            const token = localStorage.getItem("agora_access_token") ?? "";
            const fullUrl = `${getWsBase()}${url}?token=${encodeURIComponent(token)}`;

            onStatusChangeRef.current("connecting");

            const ws = new WebSocket(fullUrl);
            wsInstance = ws;

            ws.onopen = () => {
                if (destroyed) {
                    ws.close(1000);
                    return;
                }
                reconnectCount = 0;
                onStatusChangeRef.current("connected");
            };

            ws.onmessage = (e: MessageEvent) => {
                if (destroyed) return;
                try {
                    const event = JSON.parse(String(e.data)) as WsEvent;
                    if (
                        event.type === "turn_completed" ||
                        event.type === "turn_failed"
                    ) {
                        debateDone = true;
                    }
                    onEventRef.current(event);
                } catch {
                    // Ignore malformed messages
                }
            };

            ws.onclose = (e: CloseEvent) => {
                if (destroyed) return;
                wsInstance = null;

                // Intentional closes (1000 = Normal, 1001 = Going Away)
                // or debate already finished — no need to reconnect
                if (e.code === 1000 || e.code === 1001 || debateDone) {
                    onStatusChangeRef.current("disconnected");
                    return;
                }

                if (reconnectCount < maxReconnects) {
                    reconnectCount++;
                    onStatusChangeRef.current("disconnected");
                    reconnectTimer = setTimeout(doConnect, 2000);
                } else {
                    onStatusChangeRef.current("error");
                }
            };

            // onerror is always followed by onclose — handled there
        }

        doConnect();

        return () => {
            destroyed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (wsInstance) {
                wsInstance.close(1000);
                wsInstance = null;
            }
        };
    }, [url, maxReconnects]); // Only reconnect when url changes
}
