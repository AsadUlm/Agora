import { getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { motion } from "motion/react";

export default function SupportEdge(props: EdgeProps) {
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
        stroke: "#34d399",
        strokeWidth: 2,
        filter: "drop-shadow(0 0 3px rgba(52, 211, 153, 0.3))",
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
                transition={{ duration: 0.6, ease: "easeOut" }}
            />
            {props.label && (
                <text>
                    <textPath
                        href={`#${id}`}
                        startOffset="50%"
                        textAnchor="middle"
                        className="fill-emerald-300 text-[10px]"
                    >
                        {props.label as string}
                    </textPath>
                </text>
            )}
        </>
    );
}
