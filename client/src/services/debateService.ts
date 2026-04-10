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
