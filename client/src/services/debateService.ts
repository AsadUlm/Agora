import api from "./api";
import type {
    SessionDetailDTO,
    SessionListItemDTO,
    DebateStartRequest,
    DebateStartResponse,
    TurnDTO,
} from "../types/debate";

export async function startDebate(
    data: DebateStartRequest,
): Promise<DebateStartResponse> {
    const res = await api.post<DebateStartResponse>("/debates/start", data);
    return res.data;
}

export async function listDebates(): Promise<SessionListItemDTO[]> {
    const res = await api.get<SessionListItemDTO[]>("/debates");
    return res.data;
}

export async function getDebate(id: string): Promise<SessionDetailDTO> {
    const res = await api.get<SessionDetailDTO>(`/debates/${id}`);
    return res.data;
}

export async function getTurn(
    debateId: string,
    turnId: string,
): Promise<TurnDTO> {
    const res = await api.get<TurnDTO>(`/debates/${debateId}/turns/${turnId}`);
    return res.data;
}

export function buildWsUrl(wsPath: string): string {
    const base = (import.meta.env.VITE_WS_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000")
        .replace(/^http/, "ws");
    const token = localStorage.getItem("agora_access_token") ?? "";
    return `${base}${wsPath}?token=${encodeURIComponent(token)}`;
}
