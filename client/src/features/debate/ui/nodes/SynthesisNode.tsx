import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import type { DebateGraphNode } from "../../model/graph.types";
import { useGraphStore } from "../../model/graph.store";
import { truncateNodeText, formatFinalSummary } from "../../model/formatters";

type SynthesisNodeData = DebateGraphNode & { label: string; dimmedByRound?: boolean; dimmedBySelection?: boolean };

export default function SynthesisNode({
    data,
    id,
    selected,
}: NodeProps & { data: SynthesisNodeData }) {
    const nodeStatus = data.status ?? "hidden";
    const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
    const dimmedByFocus = focusedNodeId != null && focusedNodeId !== id;
    const dimmed = dimmedByFocus || data.dimmedByRound || data.dimmedBySelection;

    const displayText = truncateNodeText(formatFinalSummary(data.summary), 120) || "Final Synthesis";

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
                    stiffness: 150,
                    damping: 20,
                    delay: 0.3,
                }}
                className={`
          relative px-6 py-5 rounded-2xl
          bg-gradient-to-br from-violet-600/90 to-purple-800/90
          border-2 border-violet-400/50
          shadow-lg shadow-violet-500/20
          min-w-[240px] max-w-[360px]
          text-center cursor-pointer
          transition-all duration-300
          ${selected ? "glow-synthesis border-violet-300 scale-105" : "hover:border-violet-400/70"}
          ${nodeStatus === "active" ? "ring-2 ring-violet-400/40" : ""}
        `}
            >
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!bg-violet-400 !w-3 !h-3 !border-2 !border-violet-900"
                />
                <Handle
                    type="target"
                    position={Position.Left}
                    id="left"
                    className="!bg-violet-400 !w-2 !h-2 !border-2 !border-violet-900"
                />
                <Handle
                    type="target"
                    position={Position.Right}
                    id="right"
                    className="!bg-violet-400 !w-2 !h-2 !border-2 !border-violet-900"
                />

                <div className="text-[10px] uppercase tracking-widest text-violet-200/70 mb-1.5 font-semibold">
                    ✨ Synthesis
                </div>
                <div className="text-sm font-medium text-white leading-snug">
                    {displayText}
                </div>

                {nodeStatus === "active" && (
                    <motion.div
                        className="absolute inset-0 rounded-2xl border-2 border-violet-300/30"
                        animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                    />
                )}
            </motion.div>
        </AnimatePresence>
    );
}
