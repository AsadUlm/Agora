import { getBezierPath } from "@xyflow/react";
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

    const [edgePath] = getBezierPath({
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

    const baseStyle = {
        stroke: "#f472b6",
        strokeWidth: 2,
        strokeDasharray: "6 3",
        filter: "drop-shadow(0 0 4px rgba(244, 114, 182, 0.4))",
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
            {props.label && (
                <text>
                    <textPath
                        href={`#${id}`}
                        startOffset="50%"
                        textAnchor="middle"
                        className="fill-pink-300 text-[10px]"
                    >
                        {props.label as string}
                    </textPath>
                </text>
            )}
        </>
    );
}
