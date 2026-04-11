import { useEffect, useRef } from "react";
import type { WsEvent, ConnectionStatus } from "../types/ws";
import { buildWsUrl } from "../services/debateService";

interface Options {
    /** Relative path, e.g. "/ws/chat-turns/{id}". null = don't connect. */
    url: string | null;
    onEvent: (event: WsEvent) => void;
    onStatusChange: (status: ConnectionStatus) => void;
    /** Max reconnect attempts on unexpected disconnect. Default: 2 */
    maxReconnects?: number;
}

export function useDebateWebSocket({
    url,
    onEvent,
    onStatusChange,
    maxReconnects = 2,
}: Options): void {
    const onEventRef = useRef(onEvent);
    const onStatusChangeRef = useRef(onStatusChange);
    
    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);
    
    useEffect(() => {
        onStatusChangeRef.current = onStatusChange;
    }, [onStatusChange]);

    useEffect(() => {
        if (!url) return;

        let destroyed = false;
        let wsInstance: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectCount = 0;
        let debateDone = false;

        function doConnect() {
            if (destroyed) return;

            const fullUrl = buildWsUrl(url!);
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
                    if (event.type === "turn_completed" || event.type === "turn_failed") {
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
    }, [url, maxReconnects]);
}
