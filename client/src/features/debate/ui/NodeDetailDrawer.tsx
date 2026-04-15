import { motion, AnimatePresence } from "motion/react";
import { useGraphStore } from "../model/graph.store";
import { extractStructuredContent, formatRound1Summary, formatRound2Summary, formatFinalSummary } from "../model/formatters";

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

function getNodeSummary(node: { kind: string; round: number; summary?: string; content?: string; agentRole?: string }): string {
    const raw = node.summary || node.content;
    if (!raw) return "";
    if (node.round === 1) return formatRound1Summary(raw);
    if (node.round === 2 || node.kind === "intermediate") return formatRound2Summary(raw, node.agentRole);
    if (node.round === 3 || node.kind === "synthesis") return formatFinalSummary(raw);
    return raw;
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

    const summary = node ? getNodeSummary(node) : "";
    const contentSections = node ? extractStructuredContent(node.content) : [];

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
                        {contentSections.length > 0 && (
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

function Label({ children }: { children: React.ReactNode }) {
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
