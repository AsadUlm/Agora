import { tokenStorage } from "@/shared/api/client";
import type { WsEvent } from "./debate.types";

type EventHandler = (event: WsEvent) => void;

// Derive WebSocket base from VITE_WS_BASE_URL when set, otherwise use same
// origin so the production Docker image (http → ws, https → wss) works without
// any env configuration.
function _getWsBase(): string {
    if (import.meta.env.VITE_WS_BASE_URL) {
        return import.meta.env.VITE_WS_BASE_URL as string;
    }
    // Runtime same-origin derivation (evaluated once at module load).
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}`;
}
const WS_BASE = _getWsBase();

export class DebateWebSocket {
    private ws: WebSocket | null = null;
    private handlers: Set<EventHandler> = new Set();
    private _turnId: string | null = null;
    private _disposed = false;
    private _reconnectAttempts = 0;
    private _maxReconnects = 5;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    get connected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    connect(turnId: string): void {
        this._turnId = turnId;
        this._disposed = false;
        this._reconnectAttempts = 0;
        this._open();
    }

    private _open(): void {
        if (this._disposed) return;

        const token = tokenStorage.getAccess();
        if (!token || !this._turnId) return;

        const url = `${WS_BASE}/ws/chat-turns/${this._turnId}?token=${encodeURIComponent(token)}`;
        this.ws = new WebSocket(url);

        if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.log("[WS] connecting", this._turnId);
        }

        this.ws.onopen = () => {
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.log("[WS] connected", this._turnId);
            }
        };

        this.ws.onmessage = (e) => {
            try {
                const event: WsEvent = JSON.parse(e.data);
                if (import.meta.env.DEV) {
                    // eslint-disable-next-line no-console
                    console.log("[WS] event", event.type, event);
                }
                this.handlers.forEach((h) => {
                    try {
                        h(event);
                    } catch {
                        /* handler error — don't kill the socket */
                    }
                });
            } catch {
                /* malformed JSON — ignore */
            }
        };

        this.ws.onclose = () => {
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.log("[WS] closed", { turnId: this._turnId, disposed: this._disposed });
            }
            if (this._disposed) return;
            this._tryReconnect();
        };

        this.ws.onerror = () => {
            if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.log("[WS] error", { turnId: this._turnId });
            }
            /* will trigger onclose */
        };
    }

    private _tryReconnect(): void {
        if (
            this._disposed ||
            this._reconnectAttempts >= this._maxReconnects
        )
            return;

        this._reconnectAttempts++;
        const delay = Math.min(1000 * 2 ** this._reconnectAttempts, 15000);
        this._reconnectTimer = setTimeout(() => this._open(), delay);
    }

    subscribe(handler: EventHandler): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    disconnect(): void {
        this._disposed = true;
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this.ws?.close();
        this.ws = null;
        this.handlers.clear();
    }
}

/** Singleton instance for current debate */
export const debateWs = new DebateWebSocket();
