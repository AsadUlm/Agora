import api from "./api";
import type { DocumentDTO } from "../types/debate";

export async function uploadDocument(
    sessionId: string,
    file: File,
): Promise<DocumentDTO> {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<DocumentDTO>(
        `/documents/upload?session_id=${encodeURIComponent(sessionId)}`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data;
}

export async function listDocuments(sessionId: string): Promise<DocumentDTO[]> {
    const res = await api.get<DocumentDTO[]>(
        `/documents?session_id=${encodeURIComponent(sessionId)}`,
    );
    return res.data;
}

export async function deleteDocument(
    documentId: string,
    sessionId: string,
): Promise<void> {
    await api.delete(
        `/documents/${encodeURIComponent(documentId)}?session_id=${encodeURIComponent(sessionId)}`,
    );
}
