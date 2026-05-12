import apiClient from "@/shared/api/client";
import type {
    DebateListItem,
    DebateStartRequest,
    DebateStartResponse,
    DocumentAllItemDTO,
    DocumentDTO,
    DocumentUploadBatchResponseDTO,
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
        { headers: { "Content-Type": null } },
    );
    return res.data;
}

/**
 * Step 30: upload multiple documents in one multipart request.
 * Backend returns 207 Multi-Status with `{ uploaded, failed }`.
 */
export async function uploadDocumentsBatch(
    sessionId: string,
    files: File[],
): Promise<DocumentUploadBatchResponseDTO> {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const res = await apiClient.post<DocumentUploadBatchResponseDTO>(
        `/documents/upload-batch?session_id=${sessionId}`,
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

export async function listAllDocuments(): Promise<DocumentAllItemDTO[]> {
    const res = await apiClient.get<DocumentAllItemDTO[]>("/documents/all");
    return res.data;
}

export async function downloadDocumentBlob(documentId: string): Promise<{ blob: Blob; filename: string }> {
    const res = await apiClient.get<Blob>(`/documents/${documentId}/download`, {
        responseType: "blob",
    });
    const disposition = (res.headers as Record<string, string>)["content-disposition"] ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? "document";
    return { blob: res.data, filename };
}

export async function deleteDocument(
    documentId: string,
    sessionId: string,
): Promise<void> {
    await apiClient.delete(
        `/documents/${documentId}?session_id=${sessionId}`,
    );
}

// ── Follow-up debate cycles ──────────────────────────────────────────────────

export interface FollowUpCreateResponse {
    follow_up_id: string;
    debate_id: string;
    turn_id: string;
    cycle_number: number;
    question: string;
    status: string;
    ws_session_url: string;
    ws_turn_url: string;
}

export async function postFollowUp(
    debateId: string,
    question: string,
): Promise<FollowUpCreateResponse> {
    const res = await apiClient.post<FollowUpCreateResponse>(
        `/debates/${debateId}/follow-ups`,
        { question },
    );
    return res.data;
}

// ── Step-by-step controls (Step 14) ──────────────────────────────────────────

export interface NextStepResponse {
    turn_id: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    execution_mode: "auto" | "manual";
    released: boolean;
    pending_step: {
        round_number: number;
        agent_id: string;
        agent_role: string;
        message_type: string;
    } | null;
}

export async function nextStep(debateId: string): Promise<NextStepResponse> {
    const res = await apiClient.post<NextStepResponse>(
        `/debates/${debateId}/next-step`,
    );
    return res.data;
}

export interface StepStateResponse {
    turn_id: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    execution_mode: "auto" | "manual";
    is_running: boolean;
    pending_step: {
        round_number: number;
        agent_id: string;
        agent_role: string;
        message_type: string;
    } | null;
    gate_set: boolean;
}

export async function getStepState(debateId: string): Promise<StepStateResponse> {
    const res = await apiClient.get<StepStateResponse>(
        `/debates/${debateId}/step-state`,
    );
    return res.data;
}

export async function resumeDebate(
    debateId: string,
): Promise<{ turn_id: string; status: string; resumed: boolean; reason?: string }> {
    const res = await apiClient.post(
        `/debates/${debateId}/resume`,
    );
    return res.data as { turn_id: string; status: string; resumed: boolean; reason?: string };
}

export async function switchToAutoRun(
    debateId: string,
): Promise<{ turn_id: string; status: string; execution_mode: string; switched: boolean }> {
    const res = await apiClient.post(
        `/debates/${debateId}/auto-run`,
    );
    return res.data as { turn_id: string; status: string; execution_mode: string; switched: boolean };
}
