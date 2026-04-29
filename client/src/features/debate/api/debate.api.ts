import apiClient from "@/shared/api/client";
import type {
    DebateListItem,
    DebateStartRequest,
    DebateStartResponse,
    DocumentDTO,
    SessionDetailDTO,
} from "./debate.types";

export interface CreateSessionResponse {
    id: string;
    title: string;
    created_at: string;
}

export async function createSession(): Promise<CreateSessionResponse> {
    const res = await apiClient.post<CreateSessionResponse>("/sessions");
    return res.data;
}

export async function startDebate(
    data: DebateStartRequest,
): Promise<DebateStartResponse> {
    const res = await apiClient.post<DebateStartResponse>(
        "/debates/start",
        data,
    );
    return res.data;
}

export async function getDebateDetail(
    debateId: string,
): Promise<SessionDetailDTO> {
    const res = await apiClient.get<SessionDetailDTO>(`/debates/${debateId}`);
    return res.data;
}

export async function listDebates(): Promise<DebateListItem[]> {
    const res = await apiClient.get<DebateListItem[]>("/debates");
    return res.data;
}

export async function uploadDocument(
    sessionId: string,
    file: File,
): Promise<DocumentDTO> {
    const form = new FormData();
    form.append("file", file);
    const res = await apiClient.post<DocumentDTO>(
        `/documents/upload?session_id=${sessionId}`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data;
}

export async function listDocuments(
    sessionId: string,
): Promise<DocumentDTO[]> {
    const res = await apiClient.get<DocumentDTO[]>(
        `/documents?session_id=${sessionId}`,
    );
    return res.data;
}

export async function deleteDocument(
    documentId: string,
    sessionId: string,
): Promise<void> {
    await apiClient.delete(
        `/documents/${documentId}?session_id=${sessionId}`,
    );
}
