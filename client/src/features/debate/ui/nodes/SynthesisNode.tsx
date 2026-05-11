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
        : truncateNodeText(formatFinalSummary(data.summary || data.content), 120) || "Final Synthesis";

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
          relative px-7 py-6 rounded-2xl
          bg-gradient-to-br from-violet-600/95 via-violet-700/95 to-purple-900/95
          border-2 border-violet-300/55
          shadow-[0_18px_45px_-18px_rgba(139,92,246,0.55)]
          min-w-[300px] max-w-[420px]
          text-center cursor-pointer
          transition-all duration-150
          ${selected ? "glow-synthesis border-violet-200 scale-[1.04]" : "hover:border-violet-300/75 hover:shadow-[0_22px_55px_-18px_rgba(139,92,246,0.7)]"}
          ${nodeStatus === "active" ? "ring-2 ring-violet-300/55" : ""}
                    ${nodeStatus === "failed" ? "border-red-400/70 shadow-red-500/30" : ""}
                    ${isGeneratingFocus ? "border-cyan-300 shadow-xl shadow-cyan-500/40 ring-2 ring-cyan-300/45" : ""}
                    ${completionPulse ? "border-emerald-300 shadow-xl shadow-emerald-500/35" : ""}
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

                <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/85 mb-2 font-bold">
                    ✦ Final Synthesis
                </div>
                <div className="text-[15px] font-semibold text-white leading-snug">
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
