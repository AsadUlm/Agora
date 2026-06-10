/**
 * Single source of truth for document status semantics on the client.
 *
 * Statuses mirror the backend:
 *   uploading  — client-only transient state while the request is in flight
 *   processing — backend transient state (should be brief; never permanent)
 *   ready      — text extracted + chunks stored (retrievable)
 *   failed     — processing failed; `error_message` explains why
 *
 * Counters are derived purely from the documents array (the backend is the
 * source of truth) so the UI can never drift into a stale "0 ready, 4 processing"
 * state after the backend has returned final statuses.
 */

export type DocumentStatus = "uploading" | "processing" | "ready" | "failed";

export const TERMINAL_STATUSES: ReadonlySet<DocumentStatus> = new Set([
    "ready",
    "failed",
]);

export interface DocLike {
    status: string;
}

export interface DocCounts {
    ready: number;
    processing: number; // uploading + processing (non-terminal)
    failed: number;
    total: number;
}

/** Derive ready / processing / failed counts from the documents array. */
export function computeDocCounts(documents: readonly DocLike[]): DocCounts {
    let ready = 0;
    let processing = 0;
    let failed = 0;
    for (const d of documents) {
        if (d.status === "ready") ready += 1;
        else if (d.status === "failed") failed += 1;
        else if (d.status === "uploading" || d.status === "processing") processing += 1;
    }
    return { ready, processing, failed, total: documents.length };
}

/** True while any document is still non-terminal (uploading/processing). */
export function hasPendingDocuments(documents: readonly DocLike[]): boolean {
    return documents.some(
        (d) => d.status === "uploading" || d.status === "processing",
    );
}

/**
 * Compact, deterministic summary string, e.g.
 *   "4 ready, 0 processing"
 *   "3 ready, 0 processing, 1 failed"
 */
export function formatDocSummary(counts: DocCounts): string {
    const parts = [`${counts.ready} ready`, `${counts.processing} processing`];
    if (counts.failed > 0) parts.push(`${counts.failed} failed`);
    return parts.join(", ");
}
