import api from "./api";
import type { DebateStartRequest, DebateStartResponse } from "../types/debate";

export async function startDebate(payload: DebateStartRequest): Promise<DebateStartResponse> {
    const { data } = await api.post<DebateStartResponse>("/debates/start", payload);
    return data;
}

export function buildWsUrl(wsPath: string): string {
    const base = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000")
        .replace(/^https?/, (s: string) => (s === "https" ? "wss" : "ws"));
    const token = localStorage.getItem("agora_access_token") ?? "";
    return `${base}${wsPath}?token=${token}`;
}
