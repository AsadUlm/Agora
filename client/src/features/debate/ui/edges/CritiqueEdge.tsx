import { getBezierPath, EdgeLabelRenderer } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { motion } from "motion/react";

export default function CritiqueEdge(props: EdgeProps) {
    const {
        id,
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        style = {},
        markerEnd,
        data,
    } = props;

    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const edgeData = (data as Record<string, unknown> | undefined) ?? {};
    const edgeStatus = edgeData.status as string | undefined;
    const isDrawing = edgeStatus === "drawing" || Boolean(edgeData.draw);
    const shouldPulse = Boolean(edgeData.pulse);
    const isDimmed = Boolean(edgeData.dimmed);
    const isSelected = Boolean(edgeData.selected);

    const baseStyle = {
        stroke: "#f472b6",
        strokeWidth: isSelected ? 3 : 2,
        strokeDasharray: "6 3",
        filter: isSelected
            ? "drop-shadow(0 0 8px rgba(244, 114, 182, 0.7))"
            : "drop-shadow(0 0 4px rgba(244, 114, 182, 0.4))",
        ...style,
    };

    return (
        <>
            <motion.path
                id={id}
                d={edgePath}
                fill="none"
                markerEnd={markerEnd}
                style={baseStyle}
                initial={isDrawing ? { pathLength: 0, opacity: 0.5 } : false}
                animate={{ pathLength: 1, opacity: isDimmed ? 0.16 : 1 }}
                transition={{ duration: 0.46, ease: "easeOut" }}
            />
            {shouldPulse && (
                <motion.path
                    d={edgePath}
                    fill="none"
                    style={{
                        stroke: "#fb7185",
                        strokeWidth: 3,
                        strokeDasharray: "10 4",
                        filter: "drop-shadow(0 0 8px rgba(251, 113, 133, 0.6))",
                    }}
                    initial={{ opacity: 0, pathLength: 0.25 }}
                    animate={{ opacity: [0.1, 0.9, 0.1], pathLength: [0.25, 1, 1] }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                />
            )}
            {/* Floating HTML badge label — readable, not rotated */}
            {!isDimmed && (
                <EdgeLabelRenderer>
                    <div
                        className="nodrag nopan absolute pointer-events-none"
                        style={{
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        }}
                    >
                        <span
                            className={`
                                inline-flex items-center gap-1
                                px-1.5 py-0.5 rounded-full
                                text-[8px] font-bold uppercase tracking-widest
                                border
                                ${isSelected
                                    ? "bg-pink-500/40 border-pink-300/70 text-pink-100 shadow-sm shadow-pink-500/30"
                                    : "bg-pink-500/20 border-pink-400/40 text-pink-200"
                                }
                            `}
                        >
                            <span>⚔</span>
                            challenges
                        </span>
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
