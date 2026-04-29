import { cn } from "@/shared/lib/cn";
import { motion } from "motion/react";
import { useModeratorStore } from "../model/moderator.store";
import { usePlaybackStore } from "../model/playback.store";
import { useGraphStore } from "../model/graph.store";
import { useAnimationStore } from "../model/animation/animation.store";
import { formatTime } from "@/shared/lib/dates";
import type { DebateGraphNode, DebateGraphEdge } from "../model/graph.types";

const activityTypeColors: Record<string, string> = {
    info: "border-gray-500 text-gray-400",
    agent: "border-indigo-500 text-indigo-300",
    round: "border-amber-500 text-amber-300",
    error: "border-red-500 text-red-300",
    synthesis: "border-violet-500 text-violet-300",
};

const roundExplanations: Record<number, { title: string; description: string }> = {
    1: {
        title: "Round 1 — Initial Proposals",
        description: "Each agent forms their initial perspective independently, presenting their opening arguments on the question.",
    },
    2: {
        title: "Round 2 — Debate & Critique",
        description: "Agents engage with each other's positions. Watch for challenges (red edges) and support (green edges) forming between agents.",
    },
    3: {
        title: "Round 3 — Synthesis",
        description: "The debate converges into a final synthesis, combining the strongest arguments from all rounds.",
    },
};

/** Build an interpretive explanation of what a selected node means in the debate. */
function buildNodeInterpretation(
    node: DebateGraphNode,
    edges: DebateGraphEdge[],
    allNodes: DebateGraphNode[],
): { meaning: string; role: string; context: string[] } {
    const relatedEdges = edges.filter(
        (e) => e.source === node.id || e.target === node.id,
    );
    const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

    if (node.kind === "question") {
        return {
            meaning: "This is the central question driving the entire debate. All agent reasoning stems from this prompt.",
            role: "Debate catalyst",
            context: [`${relatedEdges.length} agents are responding to this question.`],
        };
    }

    if (node.kind === "synthesis") {
        const incomingAgents = relatedEdges
            .filter((e) => e.target === node.id)
            .map((e) => allNodes.find((n) => n.id === e.source)?.agentRole)
            .filter((s): s is string => Boolean(s));
        return {
            meaning: "This is the final synthesis — the debate's conclusion that combines the strongest arguments from all rounds.",
            role: "Final convergence point",
            context: incomingAgents.length > 0
                ? [`Integrates perspectives from: ${incomingAgents.map(capitalize).join(", ")}`]
                : ["Combines all agent perspectives into a unified conclusion."],
        };
    }

    if (node.kind === "intermediate") {
        // Round 2 interaction node
        const outgoing = relatedEdges.filter((e) => e.source === node.id && e.round === 2);
        const incoming = relatedEdges.filter((e) => e.target === node.id && e.round === 2);
        const context: string[] = [];

        for (const edge of outgoing) {
            const target = allNodes.find((n) => n.id === edge.target);
            if (target?.agentRole) {
                context.push(`${capitalize(node.agentRole ?? "This agent")} ${edge.kind} ${capitalize(target.agentRole)}`);
            }
        }
        for (const edge of incoming) {
            const source = allNodes.find((n) => n.id === edge.source);
            if (source?.agentRole) {
                context.push(`${capitalize(source.agentRole)} ${edge.kind} ${capitalize(node.agentRole ?? "this agent")}`);
            }
        }

        return {
            meaning: `This represents ${capitalize(node.agentRole ?? "an agent")}'s engagement in the debate phase — where agents challenge, support, or question each other's positions.`,
            role: "Debate participant (Round 2)",
            context: context.length > 0 ? context : ["Participating in the agent-to-agent debate."],
        };
    }

    // Regular agent node (round 1)
    const context: string[] = [];
    const challengeEdges = relatedEdges.filter((e) => e.kind === "challenges");
    const supportEdges = relatedEdges.filter((e) => e.kind === "supports");

    if (challengeEdges.length > 0) {
        context.push(`Involved in ${challengeEdges.length} challenge${challengeEdges.length > 1 ? "s" : ""}`);
    }
    if (supportEdges.length > 0) {
        context.push(`Involved in ${supportEdges.length} support connection${supportEdges.length > 1 ? "s" : ""}`);
    }
    if (context.length === 0 && node.round === 1) {
        context.push("Presented an initial perspective in Round 1.");
    }

    return {
        meaning: `${capitalize(node.agentRole ?? "Agent")} contributes a ${node.agentRole ?? "general"}-oriented perspective to the debate.`,
        role: `${capitalize(node.agentRole ?? "Agent")} — Round ${node.round} contributor`,
        context,
    };
}

export default function ModeratorPanel() {
    const status = useModeratorStore((s) => s.status);
    const explanation = useModeratorStore((s) => s.explanation);
    const watchFor = useModeratorStore((s) => s.watchFor);
    const activityFeed = useModeratorStore((s) => s.activityFeed);
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);
    const setFocus = useGraphStore((s) => s.setFocus);
    const currentStepDescription = useAnimationStore((s) => s.currentStepDescription);

    const roundInfo = selectedRound ? roundExplanations[selectedRound] : null;
    const displayExplanation = roundInfo?.description ?? explanation;

    // Find selected node data for interpretation mode
    const selectedNode = selectedNodeId
        ? graph.nodes.find((n) => n.id === selectedNodeId)
        : null;

    const isInterpretationMode = selectedNode !== null;

    const interpretation = selectedNode
        ? buildNodeInterpretation(selectedNode, graph.edges, graph.nodes)
        : null;

    const handleActivityClick = (relatedNodeId?: string) => {
        if (relatedNodeId) {
            selectNode(relatedNodeId);
            setFocus(relatedNodeId);
        }
    };

    return (
        <div className="w-72 h-full border-l border-agora-border bg-agora-surface/60 backdrop-blur-sm flex flex-col">
            {/* Header */}
            <div className="px-4 py-4 border-b border-agora-border">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest text-agora-text-muted font-semibold">
                        Moderator
                    </h2>
                    <span
                        className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-medium",
                            selectedRound
                                ? "bg-indigo-500/20 text-indigo-400"
                                : status === "Live"
                                    ? "bg-indigo-500/20 text-indigo-400"
                                    : status === "Completed"
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : status === "Failed"
                                            ? "bg-red-500/20 text-red-400"
                                            : "bg-gray-500/20 text-gray-400",
                        )}
                    >
                        {selectedRound ? `Round ${selectedRound}` : status}
                    </span>
                </div>
            </div>

            {/* Current Step Description */}
            {currentStepDescription && !isInterpretationMode && (
                <div className="px-4 py-3 border-b border-agora-border bg-indigo-500/5">
                    <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-1">
                        Current Step
                    </div>
                    <motion.p
                        key={currentStepDescription}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs text-white leading-relaxed"
                    >
                        {currentStepDescription}
                    </motion.p>
                </div>
            )}

            {/* Interpretation Mode: contextual explanation of selected node */}
            {isInterpretationMode && selectedNode && interpretation ? (
                <div className="flex-1 overflow-y-auto">
                    <div className="px-4 py-3 border-b border-agora-border flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold">
                            Interpretation
                        </div>
                        <button
                            onClick={() => selectNode(null)}
                            className="text-[10px] text-agora-text-muted hover:text-white transition-colors px-2 py-0.5 rounded bg-agora-surface-light/30 hover:bg-agora-surface-light/60"
                        >
                            ✕ Close
                        </button>
                    </div>
                    <div className="px-4 py-3 space-y-4">
                        {/* What is this */}
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                                What This Means
                            </div>
                            <p className="text-xs text-agora-text leading-relaxed">
                                {interpretation.meaning}
                            </p>
                        </div>

                        {/* Role in debate */}
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                                Role in Debate
                            </div>
                            <p className="text-xs text-white leading-relaxed">
                                {interpretation.role}
                            </p>
                        </div>

                        {/* Context: what happened around this node */}
                        {interpretation.context.length > 0 && (
                            <div>
                                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                                    Context
                                </div>
                                <ul className="space-y-1">
                                    {interpretation.context.map((item, i) => (
                                        <li
                                            key={i}
                                            className="text-[11px] text-agora-text-muted flex items-start gap-1.5"
                                        >
                                            <span className="text-indigo-400 mt-0.5">›</span>
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Hint to use detail panel */}
                        <div className="text-[10px] text-gray-600 italic pt-2 border-t border-agora-border">
                            Full content is available in the Detail Panel →
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Explanation */}
                    <div className="px-4 py-3 border-b border-agora-border">
                        <motion.p
                            key={displayExplanation}
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xs text-agora-text leading-relaxed"
                        >
                            {displayExplanation}
                        </motion.p>
                    </div>

                    {/* Watch For */}
                    {watchFor.length > 0 && (
                        <div className="px-4 py-3 border-b border-agora-border">
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-2">
                                👁 Watch For
                            </div>
                            <ul className="space-y-1">
                                {watchFor.map((item, i) => (
                                    <motion.li
                                        key={i}
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.1 }}
                                        className="text-[11px] text-agora-text-muted flex items-start gap-1.5"
                                    >
                                        <span className="text-indigo-400 mt-0.5">›</span>
                                        {item}
                                    </motion.li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Activity Feed */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="px-4 py-3">
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-2">
                                Activity
                            </div>
                            <div className="space-y-1.5">
                                {activityFeed.length === 0 && (
                                    <p className="text-[11px] text-gray-600">No activity yet.</p>
                                )}
                                {activityFeed
                                    .slice(-30)
                                    .reverse()
                                    .map((item) => (
                                        <motion.div
                                            key={item.id}
                                            initial={{ opacity: 0, y: -5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            onClick={() => handleActivityClick(item.relatedNodeId)}
                                            className={cn(
                                                "text-[11px] py-1.5 px-2.5 rounded border-l-2 bg-agora-surface-light/30",
                                                item.relatedNodeId ? "cursor-pointer hover:bg-agora-surface-light/60" : "",
                                                activityTypeColors[item.type] ?? activityTypeColors.info,
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="line-clamp-2 flex-1 leading-relaxed">{item.text}</span>
                                                {item.timestamp && (
                                                    <span className="text-[9px] text-gray-600 whitespace-nowrap mt-0.5">
                                                        {formatTime(item.timestamp)}
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
