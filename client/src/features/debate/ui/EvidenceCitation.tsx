import type { ReactNode } from "react";
import { tokenizeEvidenceText } from "../model/evidence.types";
import { cn } from "@/shared/lib/cn";

interface CitationProps {
    label: string;
    /** Labels that the backend actually attached to this message. */
    knownLabels?: ReadonlySet<string>;
    /** Optional `label → document_name` map for hover tooltips. */
    labelToDocument?: Readonly<Record<string, string>>;
}

/**
 * Inline chip rendered in place of a raw `[E#]` token. Visually highlights
 * known citations and silently mutes labels the model invented but that
 * the backend never sent (instead of "unresolved" noise in the answer).
 */
export function EvidenceCitation({ label, knownLabels, labelToDocument }: CitationProps) {
    const isKnown = !knownLabels || knownLabels.has(label);
    const docName = labelToDocument?.[label];
    const title = isKnown
        ? docName
            ? `${label} — ${docName}`
            : `Cited evidence ${label}`
        : `${label} was not provided to this agent (unresolved citation)`;
    return (
        <span
            className={cn(
                "inline-flex items-center px-1 mx-[1px] rounded text-[10px] font-mono font-semibold align-baseline whitespace-nowrap",
                isKnown
                    ? "bg-indigo-500/25 text-indigo-100 border border-indigo-400/40"
                    : "bg-agora-surface-light/40 text-agora-text-muted/80 border border-agora-border/60",
            )}
            title={title}
        >
            {label}
        </span>
    );
}

interface RenderProps {
    text: string;
    knownLabels?: ReadonlySet<string>;
    labelToDocument?: Readonly<Record<string, string>>;
}

/**
 * Render arbitrary text and replace every `[E#]` substring with an
 * `<EvidenceCitation>` chip while preserving surrounding text.
 *
 * Safe: never mutates the original string in state, returns ReactNode[].
 */
export function renderTextWithCitations({
    text,
    knownLabels,
    labelToDocument,
}: RenderProps): ReactNode[] {
    const tokens = tokenizeEvidenceText(text);
    if (tokens.length === 0) return [text];
    return tokens.map((tok, i) => {
        if (tok.kind === "label") {
            return (
                <EvidenceCitation
                    key={`cite-${i}`}
                    label={tok.value}
                    knownLabels={knownLabels}
                    labelToDocument={labelToDocument}
                />
            );
        }
        return <span key={`txt-${i}`}>{tok.value}</span>;
    });
}
