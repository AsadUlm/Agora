import type { EvidenceRetrievalMetadata } from "../model/evidence.types";
import { cn } from "@/shared/lib/cn";

interface Props {
    retrieval: EvidenceRetrievalMetadata | null | undefined;
    /** Compact mode renders an inline pill suitable for tight headers / cards. */
    compact?: boolean;
    className?: string;
}

/**
 * Small, neutral "Evidence used" indicator for an individual agent message.
 *
 * Render rules:
 *   - `retrieval` missing entirely → render nothing (legacy / no-RAG message).
 *   - `total_chunks > 0`           → show pill: "Evidence: N chunks · E1, E2".
 *   - `total_chunks === 0`         → subtle warning "No evidence retrieved".
 */
export default function EvidenceUsageBadge({ retrieval, compact, className }: Props) {
    if (!retrieval) return null;
    const totalChunks = retrieval.total_chunks ?? 0;
    const labels = retrieval.evidence_labels ?? [];

    if (totalChunks === 0) {
        return (
            <span
                className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200",
                    className,
                )}
                title="The agent ran with RAG enabled but no relevant chunks were retrieved for this response."
            >
                <span aria-hidden>⚠</span>
                <span>No evidence retrieved</span>
            </span>
        );
    }

    const labelsPreview =
        labels.length === 0
            ? null
            : labels.length <= 4
                ? labels.join(", ")
                : `${labels.slice(0, 4).join(", ")} +${labels.length - 4}`;

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full border border-indigo-500/35 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-100",
                compact && "px-1.5 py-0",
                className,
            )}
            title={`Retrieval used: ${totalChunks} chunk${totalChunks === 1 ? "" : "s"}${labels.length ? ` · ${labels.join(", ")}` : ""}`}
        >
            <span aria-hidden>📑</span>
            <span>
                {compact
                    ? labels.length > 0 ? labels.slice(0, 3).join(",") : `${totalChunks}c`
                    : `Evidence: ${totalChunks} chunk${totalChunks === 1 ? "" : "s"}`}
            </span>
            {!compact && labelsPreview && (
                <span className="font-mono text-[10px] text-indigo-200/90">
                    · {labelsPreview}
                </span>
            )}
        </span>
    );
}
