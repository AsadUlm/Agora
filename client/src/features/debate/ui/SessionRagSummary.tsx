import { useMemo } from "react";
import { useGraphStore } from "../model/graph.store";
import { useDebateStore } from "../model/debate.store";
import { parseEvidenceRetrieval } from "../model/evidence.types";
import { cn } from "@/shared/lib/cn";

/**
 * Compact session-level RAG summary.
 *
 * Pulled from the graph store: every agent node whose backend payload
 * carried a `retrieval` blob contributes to the counts. Renders nothing
 * when no message has retrieval metadata AND no documents were uploaded
 * (i.e. RAG is genuinely not part of this session).
 *
 * Surfaces three useful signals:
 *   - How many agent responses actually drew on evidence.
 *   - How many distinct source documents were touched.
 *   - How many responses had RAG enabled but came back empty (warning).
 *   - "Docs uploaded but never used" hint when retrieval never fired.
 */
export default function SessionRagSummary({ className }: { className?: string }) {
    const nodes = useGraphStore((s) => s.graph.nodes);
    const documentCount = useDebateStore((s) => s.documentCount);
    const ragActive = useDebateStore((s) => s.ragActive);

    const stats = useMemo(() => {
        let messagesWithRetrieval = 0;
        let messagesWithEvidence = 0;
        let emptyRetrievalCount = 0;
        const documentNames = new Set<string>();
        const allLabels = new Set<string>();

        for (const node of nodes) {
            const ev = parseEvidenceRetrieval(node.metadata);
            if (!ev) continue;
            messagesWithRetrieval += 1;
            const chunkCount = ev.total_chunks ?? 0;
            if (chunkCount > 0) {
                messagesWithEvidence += 1;
                for (const lbl of ev.evidence_labels ?? []) allLabels.add(lbl);
                for (const doc of ev.documents ?? []) {
                    if (doc.document_name) documentNames.add(doc.document_name);
                }
            } else {
                emptyRetrievalCount += 1;
            }
        }

        return {
            messagesWithRetrieval,
            messagesWithEvidence,
            emptyRetrievalCount,
            documents: Array.from(documentNames),
            labels: Array.from(allLabels),
        };
    }, [nodes]);

    const docsUploadedButUnused =
        documentCount > 0 &&
        stats.messagesWithRetrieval === 0 &&
        ragActive !== false;

    // Render nothing if RAG is genuinely absent from this session.
    if (stats.messagesWithRetrieval === 0 && !docsUploadedButUnused) {
        return null;
    }

    if (docsUploadedButUnused) {
        return (
            <div
                className={cn(
                    "rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2",
                    className,
                )}
            >
                <div className="text-[10px] uppercase tracking-widest text-amber-200/90 font-semibold mb-1">
                    RAG status
                </div>
                <p className="text-[11px] text-amber-100/90 leading-relaxed">
                    {documentCount} document{documentCount === 1 ? "" : "s"} uploaded
                    but no relevant chunks were retrieved yet. Check document status,
                    agent <em>knowledge mode</em>, or wait for embedding to finish.
                </p>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-3 py-2",
                className,
            )}
        >
            <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-[10px] uppercase tracking-widest text-indigo-200/90 font-semibold">
                    RAG summary
                </div>
                {stats.emptyRetrievalCount > 0 && (
                    <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/10 text-amber-200"
                        title="Some responses had retrieval enabled but received zero chunks."
                    >
                        ⚠ {stats.emptyRetrievalCount} empty
                    </span>
                )}
            </div>
            <p className="text-[11px] text-indigo-100/95 leading-relaxed">
                Evidence used in <strong>{stats.messagesWithEvidence}</strong> of{" "}
                <strong>{stats.messagesWithRetrieval}</strong> agent response
                {stats.messagesWithRetrieval === 1 ? "" : "s"}
                {stats.documents.length > 0 && (
                    <>
                        {" · "}
                        <strong>{stats.documents.length}</strong> source document
                        {stats.documents.length === 1 ? "" : "s"}
                    </>
                )}
                {stats.labels.length > 0 && (
                    <>
                        {" · "}
                        <strong>{stats.labels.length}</strong> citation label
                        {stats.labels.length === 1 ? "" : "s"}
                    </>
                )}
                {"."}
            </p>
            {stats.documents.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                    {stats.documents.slice(0, 6).map((doc) => (
                        <span
                            key={doc}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-agora-surface-light/40 text-agora-text-muted truncate max-w-[160px]"
                            title={doc}
                        >
                            {doc}
                        </span>
                    ))}
                    {stats.documents.length > 6 && (
                        <span className="text-[10px] text-agora-text-muted/80">
                            +{stats.documents.length - 6} more
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
