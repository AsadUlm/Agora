import { useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useGraphStore } from "../model/graph.store";
import { extractStructuredContent, getTurnSummary } from "../model/formatters";

const kindLabels: Record<string, string> = {
    question: "Question",
    agent: "Agent",
    synthesis: "Synthesis",
    intermediate: "Agent (Round 2)",
};

const roundLabels: Record<number, string> = {
    1: "Round 1 — Initial Proposal",
    2: "Round 2 — Debate & Critique",
    3: "Round 3 — Synthesis",
};

interface RetrievalChunkPreview {
    text: string;
    score: number;
}

interface RetrievalDocumentGroup {
    document_id: string;
    document_name: string;
    chunks: RetrievalChunkPreview[];
}

interface RetrievalSummary {
    documents: RetrievalDocumentGroup[];
    total_chunks: number;
}

function parseRetrieval(meta: unknown): RetrievalSummary | null {
    if (!meta || typeof meta !== "object") return null;
    const r = (meta as Record<string, unknown>)["retrieval"];
    if (!r || typeof r !== "object") return null;
    const obj = r as Record<string, unknown>;
    const docs = obj["documents"];
    if (!Array.isArray(docs)) return null;
    return {
        documents: docs as RetrievalDocumentGroup[],
        total_chunks: typeof obj["total_chunks"] === "number" ? (obj["total_chunks"] as number) : 0,
    };
}

export default function NodeDetailDrawer() {
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);

    const node = selectedNodeId
        ? graph.nodes.find((n) => n.id === selectedNodeId)
        : null;

    const relatedEdges = selectedNodeId
        ? graph.edges.filter(
            (e) => e.source === selectedNodeId || e.target === selectedNodeId,
        )
        : [];

    const isLoading = Boolean(node?.metadata?.["loading"] && !node?.content);

    const summary = useMemo(() => {
        if (!node) return "";
        return getTurnSummary({
            raw: node.summary || node.content,
            round: node.round,
            kind: node.kind,
            sourceRole: node.agentRole,
        });
    }, [node]);

    const contentSections = useMemo(() => {
        if (!node) return [];
        return extractStructuredContent(node.content || node.summary, node.round, node.kind);
    }, [node]);

    const rawOutput = (node?.content || node?.summary || "").trim();

    const retrieval = useMemo(() => parseRetrieval(node?.metadata), [node]);

    return (
        <AnimatePresence>
            {node && (
                <motion.div
                    initial={{ x: 400, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 400, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="absolute top-0 right-0 w-80 h-full bg-agora-surface border-l border-agora-border shadow-2xl shadow-black/50 z-50 flex flex-col"
                >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-agora-border flex items-center justify-between">
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                                {kindLabels[node.kind] ?? node.kind}
                            </div>
                            <div className="text-sm font-medium text-white">
                                {node.agentRole || node.label}
                            </div>
                        </div>
                        <button
                            onClick={() => selectNode(null)}
                            className="w-7 h-7 rounded-lg bg-agora-surface-light flex items-center justify-center text-agora-text-muted hover:text-white hover:bg-gray-600 transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {/* Meta row: Status + Round */}
                        <div className="flex items-center gap-3">
                            <div>
                                <Label>Status</Label>
                                <StatusBadge status={node.status} />
                            </div>
                            {node.round > 0 && (
                                <div>
                                    <Label>Round</Label>
                                    <span className="text-xs text-white">{roundLabels[node.round] ?? `Round ${node.round}`}</span>
                                </div>
                            )}
                        </div>

                        {node.agentRole && (
                            <div>
                                <Label>Role</Label>
                                <p className="text-sm text-white capitalize">{node.agentRole}</p>
                            </div>
                        )}

                        {isLoading && (
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
                                <div className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold mb-1">
                                    Generating
                                </div>
                                <p className="text-xs text-indigo-100 leading-relaxed">
                                    This agent is currently generating a response. Details will appear once content is ready.
                                </p>
                            </div>
                        )}

                        {node.status === "failed" && (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                                <div className="text-[10px] uppercase tracking-widest text-red-300 font-semibold mb-1">
                                    Generation Failed
                                </div>
                                <p className="text-xs text-red-100 leading-relaxed">
                                    This agent response failed to generate.
                                </p>
                            </div>
                        )}

                        {/* Summary — formatted per round */}
                        {summary && (
                            <div>
                                <Label>Summary</Label>
                                <p className="text-xs text-agora-text leading-relaxed bg-agora-surface-light/50 rounded-lg p-3">
                                    {summary}
                                </p>
                            </div>
                        )}

                        {/* Structured content sections */}
                        {!isLoading && contentSections.length > 0 && (
                            <div>
                                <Label>Details</Label>
                                <div className="bg-agora-surface-light/30 rounded-lg p-3 max-h-72 overflow-y-auto space-y-3">
                                    {contentSections.map((section, i) => (
                                        <div key={i}>
                                            <div className="text-[10px] uppercase tracking-wider text-agora-text-muted font-semibold mb-0.5">
                                                {section.heading}
                                            </div>
                                            <p className="text-xs text-agora-text leading-relaxed whitespace-pre-line">
                                                {section.body}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Sources — knowledge chunks used for this turn */}
                        {!isLoading && retrieval && retrieval.documents.length > 0 && (
                            <div>
                                <Label>Sources used ({retrieval.total_chunks})</Label>
                                <details className="rounded-lg border border-indigo-500/30 bg-indigo-500/5" open>
                                    <summary className="px-3 py-2 text-[11px] text-indigo-300 cursor-pointer select-none">
                                        Used private knowledge ({retrieval.documents.length} {retrieval.documents.length === 1 ? "document" : "documents"})
                                    </summary>
                                    <div className="px-3 pb-3 space-y-3">
                                        {retrieval.documents.map((doc) => (
                                            <div key={doc.document_id} className="space-y-1.5">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-[11px] font-medium text-white truncate" title={doc.document_name}>
                                                        {doc.document_name}
                                                    </div>
                                                    <div className="text-[10px] text-agora-text-muted ml-2 flex-shrink-0">
                                                        {doc.chunks.length} {doc.chunks.length === 1 ? "chunk" : "chunks"}
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    {doc.chunks.map((chunk, ci) => (
                                                        <div
                                                            key={ci}
                                                            className="rounded-md bg-agora-surface-light/40 px-2.5 py-1.5"
                                                        >
                                                            <div className="flex items-start gap-2">
                                                                <p className="text-[11px] text-agora-text leading-relaxed flex-1 whitespace-pre-line break-words">
                                                                    {chunk.text}
                                                                </p>
                                                                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/15 rounded px-1.5 py-0.5 flex-shrink-0">
                                                                    {chunk.score.toFixed(2)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            </div>
                        )}

                        {/* Debug raw output */}
                        {!isLoading && rawOutput && (
                            <details className="rounded-lg border border-agora-border bg-agora-surface-light/20">
                                <summary className="px-3 py-2 text-[11px] text-agora-text-muted cursor-pointer select-none">
                                    Raw model output
                                </summary>
                                <div className="px-3 pb-3">
                                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-agora-text-muted max-h-56 overflow-y-auto">
                                        {rawOutput}
                                    </pre>
                                </div>
                            </details>
                        )}

                        {/* Connections */}
                        {relatedEdges.length > 0 && (
                            <div>
                                <Label>Connections ({relatedEdges.length})</Label>
                                <div className="space-y-1.5">
                                    {relatedEdges.map((edge) => {
                                        const isSource = edge.source === selectedNodeId;
                                        const otherNodeId = isSource
                                            ? edge.target
                                            : edge.source;
                                        const otherNode = graph.nodes.find(
                                            (n) => n.id === otherNodeId,
                                        );
                                        const kindLabel = edge.kind === "challenges" ? "challenges"
                                            : edge.kind === "supports" ? "supports"
                                                : edge.kind === "questions" ? "questions"
                                                    : edge.kind === "summarizes" ? "feeds into"
                                                        : edge.kind === "initial" ? "receives from"
                                                            : edge.kind;
                                        return (
                                            <button
                                                key={edge.id}
                                                onClick={() => selectNode(otherNodeId)}
                                                className="w-full text-left px-2.5 py-1.5 rounded-lg bg-agora-surface-light/30 hover:bg-agora-surface-light/60 transition-colors text-xs"
                                            >
                                                <span className="text-agora-text-muted">
                                                    {isSource ? "→" : "←"}
                                                </span>{" "}
                                                <span className="text-white">
                                                    {otherNode?.agentRole || otherNode?.label || otherNodeId}
                                                </span>
                                                <span className="ml-1.5 text-[10px] text-agora-text-muted italic">
                                                    {kindLabel}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function Label({ children }: { children: ReactNode }) {
    return (
        <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
            {children}
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        active: "bg-indigo-500/20 text-indigo-400",
        completed: "bg-emerald-500/20 text-emerald-400",
        failed: "bg-red-500/20 text-red-300",
        visible: "bg-gray-500/20 text-gray-400",
        hidden: "bg-gray-700/20 text-gray-600",
    };

    return (
        <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${colors[status] ?? colors.visible}`}
        >
            {status}
        </span>
    );
}
