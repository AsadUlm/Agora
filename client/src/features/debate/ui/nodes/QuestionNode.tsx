import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import type { DebateGraphNode } from "../../model/graph.types";
import { useGraphStore } from "../../model/graph.store";

type QuestionNodeData = DebateGraphNode & { label: string; dimmedByRound?: boolean; dimmedBySelection?: boolean };

export default function QuestionNode({
    data,
    id,
    selected,
}: NodeProps & { data: QuestionNodeData }) {
    const nodeStatus = data.status ?? "visible";
    const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
    const dimmedByFocus = focusedNodeId != null && focusedNodeId !== id;
    const dimmed = dimmedByFocus || data.dimmedByRound || data.dimmedBySelection;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{
                    scale: nodeStatus === "hidden" ? 0 : 1,
                    opacity: nodeStatus === "hidden" ? 0 : dimmed ? 0.35 : 1,
                }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                className={`
          relative px-6 py-4 rounded-2xl
          bg-gradient-to-br from-indigo-600/90 to-purple-700/90
          border-2 border-indigo-400/50
          shadow-lg shadow-indigo-500/20
          min-w-[200px] max-w-[300px]
          text-center cursor-pointer
          transition-all duration-300
          ${selected ? "glow-accent border-indigo-300" : "hover:border-indigo-400/70"}
        `}
            >
                <div className="text-[10px] uppercase tracking-widest text-indigo-200/70 mb-1 font-semibold">
                    Question
                </div>
                <div className="text-sm font-medium text-white leading-snug">
                    {data.label?.slice(0, 80) ?? "Question"}
                </div>

                <Handle
                    type="source"
                    position={Position.Bottom}
                    className="!bg-indigo-400 !w-3 !h-3 !border-2 !border-indigo-900"
                />
                <Handle
                    type="source"
                    position={Position.Left}
                    id="left"
                    className="!bg-indigo-400 !w-2 !h-2 !border-2 !border-indigo-900"
                />
                <Handle
                    type="source"
                    position={Position.Right}
                    id="right"
                    className="!bg-indigo-400 !w-2 !h-2 !border-2 !border-indigo-900"
                />
            </motion.div>
        </AnimatePresence>
    );
}
