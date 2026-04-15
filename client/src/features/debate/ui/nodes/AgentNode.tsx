import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import type { DebateGraphNode } from "../../model/graph.types";
import { useGraphStore } from "../../model/graph.store";
import { truncateNodeText } from "../../model/formatters";

type AgentNodeData = DebateGraphNode & { label: string; dimmedByRound?: boolean; dimmedBySelection?: boolean };

const statusStyles: Record<string, string> = {
    hidden: "opacity-0 scale-0",
    entering: "opacity-100 border-white/40 ring-1 ring-white/10",
    visible: "opacity-80 border-gray-600",
    active:
        "opacity-100 border-indigo-400 shadow-md shadow-indigo-500/30 ring-2 ring-indigo-500/20",
    completed: "opacity-100 border-emerald-500/60",
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
    const dimmed = dimmedByFocus || data.dimmedByRound || data.dimmedBySelection;

    const maxLen = data.kind === "intermediate" ? 120 : 90;
    const displayText = truncateNodeText(data.summary, maxLen) || data.label;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                    scale: nodeStatus === "hidden" ? 0 : 1,
                    opacity: nodeStatus === "hidden" ? 0 : dimmed ? 0.3 : 1,
                }}
                transition={{
                    type: "spring",
                    stiffness: 180,
                    damping: 18,
                    delay: 0.1,
                }}
                className={`
          relative px-5 py-4 rounded-xl
          bg-gradient-to-br ${gradient}
          border-2 
          min-w-[180px] max-w-[240px]
          cursor-pointer transition-all duration-300
          ${statusStyles[nodeStatus] ?? ""}
          ${selected ? "ring-2 ring-white/30 scale-105" : "hover:scale-[1.03]"}
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
                </div>

                <div className="text-xs font-medium text-white/90 leading-snug line-clamp-4">
                    {displayText}
                </div>

                {nodeStatus === "active" && (
                    <motion.div
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-indigo-400"
                        animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
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
