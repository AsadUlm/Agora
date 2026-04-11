import api from "./api";
import type {
    DebateDetail,
    DebateListItem,
    DebateStartRequest,
    DebateStartResponse,
} from "../types/debate";

export async function startDebate(
    data: DebateStartRequest,
): Promise<DebateStartResponse> {
    const res = await api.post<DebateStartResponse>("/debates/start", data);
    return res.data;
}

export async function getDebate(id: string): Promise<DebateDetail> {
    const res = await api.get<DebateDetail>(`/debates/${id}`);
    return res.data;
}

export async function listDebates(): Promise<DebateListItem[]> {
    const res = await api.get<DebateListItem[]>("/debates");
    return res.data;
}

export function buildWsUrl(wsPath: string): string {
    const base = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000")
        .replace(/^https?/, (s: string) => (s === "https" ? "wss" : "ws"));
    const token = localStorage.getItem("agora_access_token") ?? "";
    return `${base}${wsPath}?token=${encodeURIComponent(token)}`;
}
