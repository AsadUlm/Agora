import { getBezierPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { motion } from "motion/react";

export default function InquiryEdge(props: EdgeProps) {
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
    const isDimmed = Boolean(edgeData.dimmed);

    const baseStyle = {
        stroke: "#818cf8",
        strokeWidth: 1.5,
        strokeDasharray: "4 4",
        filter: "drop-shadow(0 0 2px rgba(129, 140, 248, 0.3))",
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
                transition={{ duration: 0.42, ease: "easeOut" }}
            />
            {props.label && (
                <text>
                    <textPath
                        href={`#${id}`}
                        startOffset="50%"
                        textAnchor="middle"
                        className="fill-indigo-300 text-[10px]"
                    >
                        {props.label as string}
                    </textPath>
                </text>
            )}
        </>
    );
}
