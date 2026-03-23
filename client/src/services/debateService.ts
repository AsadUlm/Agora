import api from "./api";
import type {
    StartDebateRequest,
    DebateStartResponse,
    DebateResponse,
} from "../types/debate";

export async function startDebate(
    payload: StartDebateRequest,
): Promise<DebateStartResponse> {
    const { data } = await api.post<DebateStartResponse>(
        "/debates/start",
        payload,
    );
    return data;
}

export async function getDebateById(id: string): Promise<DebateResponse> {
    const { data } = await api.get<DebateResponse>(`/debates/${encodeURIComponent(id)}`);
    return data;
}
