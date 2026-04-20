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

    const edgeStatus = (data as Record<string, unknown>)?.status as string | undefined;
    const isDrawing = edgeStatus === "drawing";

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
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
            />
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
