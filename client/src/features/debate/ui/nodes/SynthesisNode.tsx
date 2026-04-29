import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import type { DebateGraphNode } from "../../model/graph.types";
import { useGraphStore } from "../../model/graph.store";
import { truncateNodeText, formatFinalSummary } from "../../model/formatters";

type SynthesisNodeData = DebateGraphNode & {
    label: string;
    dimmedByRound?: boolean;
    dimmedBySelection?: boolean;
    dimmedByGeneration?: boolean;
    isGeneratingFocus?: boolean;
    completionPulse?: boolean;
};

export default function SynthesisNode({
    data,
    id,
    selected,
}: NodeProps & { data: SynthesisNodeData }) {
    const nodeStatus = data.status ?? "hidden";
    const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
    const dimmedByFocus = focusedNodeId != null && focusedNodeId !== id;
    const dimmed = dimmedByFocus || data.dimmedByRound || data.dimmedBySelection || data.dimmedByGeneration;
    const isLoading = Boolean(data.metadata?.["loading"] && !data.content);
    const loadingLabel =
        typeof data.metadata?.["loadingLabel"] === "string"
            ? String(data.metadata["loadingLabel"])
            : "Synthesizing conclusions";
    const isGeneratingFocus = Boolean(data.isGeneratingFocus);
    const completionPulse = Boolean(data.completionPulse);

    const displayText = isLoading
        ? `${loadingLabel}...`
        : truncateNodeText(formatFinalSummary(data.summary), 120) || "Final Synthesis";

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
          relative px-6 py-5 rounded-2xl
          bg-gradient-to-br from-violet-600/90 to-purple-800/90
          border-2 border-violet-400/50
          shadow-lg shadow-violet-500/20
          min-w-[240px] max-w-[360px]
          text-center cursor-pointer
          transition-all duration-150
          ${selected ? "glow-synthesis border-violet-300 scale-105" : "hover:border-violet-400/70"}
          ${nodeStatus === "active" ? "ring-2 ring-violet-400/40" : ""}
                    ${nodeStatus === "failed" ? "border-red-500/60 shadow-red-500/20" : ""}
                    ${isGeneratingFocus ? "border-cyan-300 shadow-xl shadow-cyan-500/35 ring-2 ring-cyan-300/45" : ""}
                    ${completionPulse ? "border-emerald-300 shadow-xl shadow-emerald-500/30" : ""}
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

                {isLoading && (
                    <div className="mt-2 text-[10px] text-cyan-100/95 flex items-center justify-center gap-1.5 rounded-md bg-white/10 px-2 py-1">
                        <span>{loadingLabel}</span>
                        <TypingDots />
                    </div>
                )}

                {nodeStatus === "failed" && (
                    <div className="mt-2 text-[10px] text-red-200/90">
                        Synthesis failed.
                    </div>
                )}

                {(nodeStatus === "active" || isLoading) && (
                    <motion.div
                        className="absolute inset-0 rounded-2xl border-2 border-violet-300/30"
                        animate={{ scale: [1, 1.05, 1], opacity: [0.3, 0.1, 0.3] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                    />
                )}

                {completionPulse && (
                    <motion.div
                        className="absolute inset-0 rounded-2xl border-2 border-emerald-300/70"
                        animate={{ opacity: [0.18, 0.62, 0.2], scale: [1, 1.03, 1] }}
                        transition={{ repeat: Infinity, duration: 1.2, ease: "easeOut" }}
                    />
                )}
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
                    className="h-1 w-1 rounded-full bg-cyan-100"
                    animate={{ opacity: [0.25, 1, 0.25], y: [0, -1, 0] }}
                    transition={{ duration: 0.9, ease: "easeOut", repeat: Infinity, delay: idx * 0.14 }}
                />
            ))}
        </span>
    );
}
