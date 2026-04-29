import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import type { DebateGraphNode } from "../../model/graph.types";
import { useGraphStore } from "../../model/graph.store";
import { truncateNodeText } from "../../model/formatters";

type AgentNodeData = DebateGraphNode & {
    label: string;
    dimmedByRound?: boolean;
    dimmedBySelection?: boolean;
    dimmedByGeneration?: boolean;
    isGeneratingFocus?: boolean;
};

const statusStyles: Record<string, string> = {
    hidden: "opacity-0 scale-0",
    entering: "opacity-100 border-white/40 ring-1 ring-white/10",
    visible: "opacity-80 border-gray-600",
    active:
        "opacity-100 border-indigo-400 shadow-md shadow-indigo-500/30 ring-2 ring-indigo-500/20",
    completed: "opacity-100 border-emerald-500/60",
    failed: "opacity-100 border-red-500/60 ring-1 ring-red-500/20",
};

const roleColors: Record<string, string> = {
    analyst: "from-blue-600/80 to-blue-800/80",
    critic: "from-rose-600/80 to-rose-800/80",
    ethicist: "from-emerald-600/80 to-emerald-800/80",
    creative: "from-amber-600/80 to-amber-800/80",
    strategist: "from-cyan-600/80 to-cyan-800/80",
    devil_advocate: "from-red-600/80 to-red-800/80",
    default: "from-slate-600/80 to-slate-800/80",
};

function getRoleGradient(role: string | undefined): string {
    if (!role) return roleColors.default;
    const key = role.toLowerCase().replace(/\s+/g, "_");
    return roleColors[key] ?? roleColors.default;
}

function getRoleEmoji(role: string | undefined): string {
    const r = role?.toLowerCase() ?? "";
    if (r.includes("analyst")) return "🔍";
    if (r.includes("critic")) return "⚔️";
    if (r.includes("ethic")) return "⚖️";
    if (r.includes("creative")) return "💡";
    if (r.includes("strateg")) return "♟️";
    if (r.includes("devil")) return "😈";
    if (r.includes("advocate")) return "📢";
    return "🤖";
}

export default function AgentNode({
    data,
    id,
    selected,
}: NodeProps & { data: AgentNodeData }) {
    const nodeStatus = data.status ?? "visible";
    const gradient = getRoleGradient(data.agentRole);
    const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
    const dimmedByFocus = focusedNodeId != null && focusedNodeId !== id;
    const dimmed = dimmedByFocus || data.dimmedByRound || data.dimmedBySelection || data.dimmedByGeneration;
    const isLoading = Boolean(data.metadata?.["loading"] && !data.content);
    const loadingLabel =
        typeof data.metadata?.["loadingLabel"] === "string"
            ? String(data.metadata["loadingLabel"])
            : "Generating response";
    const isGeneratingFocus = Boolean(data.isGeneratingFocus);

    const maxLen = data.kind === "intermediate" ? 120 : 90;
    const displayText = isLoading
        ? `${loadingLabel}...`
        : truncateNodeText(data.summary, maxLen) || data.label;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{
                    scale: nodeStatus === "hidden" ? 0.95 : isGeneratingFocus ? 1.045 : selected ? 1.02 : 1,
                    opacity: nodeStatus === "hidden" ? 0 : dimmed ? 0.26 : 1,
                    y: nodeStatus === "hidden" ? 8 : 0,
                }}
                transition={{
                    duration: 0.2,
                    ease: "easeOut",
                }}
                className={`
          relative px-5 py-4 rounded-xl
          bg-gradient-to-br ${gradient}
          border-2
          min-w-[180px] max-w-[240px]
          cursor-pointer transition-all duration-150
          ${statusStyles[nodeStatus] ?? ""}
          ${selected ? "ring-2 ring-white/30 scale-105" : "hover:scale-[1.03]"}
          ${isGeneratingFocus ? "border-cyan-300 shadow-xl shadow-cyan-500/35 ring-2 ring-cyan-300/45" : ""}
        `}
            >
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!bg-white/50 !w-2.5 !h-2.5 !border-2 !border-gray-800"
                />

                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base">{getRoleEmoji(data.agentRole)}</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/60 font-semibold">
                        {data.agentRole ?? "Agent"}
                    </span>
                    {data.kind === "intermediate" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 font-medium">
                            R2
                        </span>
                    )}
                    {data.knowledge && data.knowledge.docCount > 0 && data.knowledge.mode !== "no_docs" && (
                        <span
                            className="ml-auto inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/25 text-indigo-100 font-medium"
                            title={
                                data.knowledge.mode === "assigned_docs_only"
                                    ? `Private knowledge: ${data.knowledge.docCount} doc${data.knowledge.docCount === 1 ? "" : "s"}`
                                    : `Session knowledge: ${data.knowledge.docCount} doc${data.knowledge.docCount === 1 ? "" : "s"}`
                            }
                        >
                            <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
                                <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                            </svg>
                            {data.knowledge.docCount}
                        </span>
                    )}
                </div>

                <div className="text-xs font-medium text-white/90 leading-snug line-clamp-3">
                    {displayText}
                </div>

                {isLoading && (
                    <div className="mt-2 text-[10px] text-cyan-100/90 flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1">
                        <span>{loadingLabel}</span>
                        <TypingDots />
                    </div>
                )}

                {nodeStatus === "failed" && (
                    <div className="mt-2 text-[10px] text-red-200/90">
                        This response failed to generate.
                    </div>
                )}

                {(nodeStatus === "active" || isLoading) && (
                    <motion.div
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-indigo-400"
                        animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                    />
                )}

                {isGeneratingFocus && (
                    <motion.div
                        className="absolute inset-0 rounded-xl border-2 border-cyan-200/70"
                        animate={{ opacity: [0.25, 0.7, 0.25], scale: [1, 1.02, 1] }}
                        transition={{ repeat: Infinity, duration: 1.1, ease: "easeOut" }}
                    />
                )}

                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!bg-white/50 !w-2.5 !h-2.5 !border-2 !border-gray-800"
                />
                <Handle
                    type="source"
                    position={Position.Left}
                    id="left"
                    className="!bg-white/30 !w-2 !h-2 !border !border-gray-700"
                />
                <Handle
                    type="source"
                    position={Position.Right}
                    id="right"
                    className="!bg-white/30 !w-2 !h-2 !border !border-gray-700"
                />
            </motion.div>
        </AnimatePresence>
    );
}

function TypingDots() {
    return (
        <span className="inline-flex items-center gap-1">
            {[0, 1, 2].map((idx) => (
                <motion.span
                    key={idx}
                    className="h-1 w-1 rounded-full bg-cyan-200"
                    animate={{ opacity: [0.25, 1, 0.25], y: [0, -1, 0] }}
                    transition={{ duration: 0.9, ease: "easeOut", repeat: Infinity, delay: idx * 0.14 }}
                />
            ))}
        </span>
    );
}
