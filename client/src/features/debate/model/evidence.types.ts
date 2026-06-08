/* ── Evidence / Retrieval metadata helpers ─────────────────────────────────
 *
 * Shared frontend types and parsers for the optional `retrieval` payload
 * attached to every agent `message_created` event by the backend
 * (`RoundManager._build_retrieval_summary`).
 *
 * Backward-compatible: every field is optional. Old messages that do not
 * carry retrieval metadata must continue to render without error.
 */

export interface EvidenceChunkPreview {
    text?: string;
    /** Cosine similarity 0..1. Backend may also send `similarity`. */
    score?: number;
    similarity?: number;
}

export interface EvidenceDocumentGroup {
    document_id?: string;
    document_name?: string;
    /** `[E1]`-style labels derived from packets that came from this document. */
    evidence_labels?: string[];
    chunks?: EvidenceChunkPreview[];
}

export interface EvidenceRetrievalMetadata {
    total_chunks?: number;
    /** All `[E1]`-style labels referenced across this message's evidence. */
    evidence_labels?: string[];
    documents?: EvidenceDocumentGroup[];
}

/**
 * Permissive parser for the `retrieval` blob attached to a message's
 * metadata. Returns `null` when the metadata is missing or shaped wrong,
 * so callers can render normally for legacy / no-RAG messages.
 */
export function parseEvidenceRetrieval(
    meta: unknown,
): EvidenceRetrievalMetadata | null {
    if (!meta || typeof meta !== "object") return null;
    const retrieval = (meta as Record<string, unknown>)["retrieval"];
    if (!retrieval || typeof retrieval !== "object") return null;

    const obj = retrieval as Record<string, unknown>;

    const docs = Array.isArray(obj["documents"])
        ? (obj["documents"] as EvidenceDocumentGroup[])
        : [];

    const totalChunks =
        typeof obj["total_chunks"] === "number"
            ? (obj["total_chunks"] as number)
            : docs.reduce(
                (acc, d) => acc + (Array.isArray(d.chunks) ? d.chunks.length : 0),
                0,
            );

    const topLabelsRaw = obj["evidence_labels"];
    const topLabels: string[] = Array.isArray(topLabelsRaw)
        ? (topLabelsRaw.filter((l) => typeof l === "string") as string[])
        : [];

    // If the backend did not send a top-level labels list, derive it from
    // the per-document arrays so the UI always has something to surface.
    const derivedLabels =
        topLabels.length > 0
            ? topLabels
            : Array.from(
                new Set(
                    docs.flatMap((d) =>
                        Array.isArray(d.evidence_labels) ? d.evidence_labels : [],
                    ),
                ),
            );

    return {
        total_chunks: totalChunks,
        evidence_labels: derivedLabels,
        documents: docs,
    };
}

/**
 * Build a `label → document_name` map for tooltip / chip rendering.
 * Returns `{}` when the retrieval metadata has no labels.
 */
export function buildLabelToDocumentMap(
    retrieval: EvidenceRetrievalMetadata | null | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    if (!retrieval?.documents) return out;
    for (const doc of retrieval.documents) {
        const name = doc.document_name ?? "Untitled document";
        for (const label of doc.evidence_labels ?? []) {
            if (typeof label === "string" && !(label in out)) {
                out[label] = name;
            }
        }
    }
    return out;
}

/** Regex matching `[E1]`, `[E12]`, … evidence citation labels. */
export const EVIDENCE_LABEL_REGEX = /\[E\d+\]/g;

/**
 * Split arbitrary text into alternating string / citation-label tokens so
 * each `[E#]` can be rendered as an inline chip without losing surrounding
 * content. Never mutates the raw text.
 */
export interface EvidenceTextToken {
    kind: "text" | "label";
    value: string;
}

export function tokenizeEvidenceText(text: string): EvidenceTextToken[] {
    if (!text) return [];
    const tokens: EvidenceTextToken[] = [];
    const regex = new RegExp(EVIDENCE_LABEL_REGEX.source, "g");
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ kind: "text", value: text.slice(lastIndex, match.index) });
        }
        tokens.push({ kind: "label", value: match[0] });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
        tokens.push({ kind: "text", value: text.slice(lastIndex) });
    }
    return tokens;
}
