import { cn } from "@/shared/lib/cn";
import { motion } from "motion/react";
import { useMemo } from "react";
import { useModeratorStore } from "../model/moderator.store";
import { usePlaybackStore } from "../model/playback.store";
import { useGraphStore } from "../model/graph.store";
import { useAnimationStore } from "../model/animation/animation.store";
import { useDebateStore } from "../model/debate.store";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
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
        title: "Round 3 — Synthesis & Verdict",
        description: "The debate converges into per-agent syntheses, then a neutral moderator aggregates them into one Overall Synthesis Verdict (look for the violet card inside the Evolution tab).",
    },
    4: {
        title: "Follow-up — Re-engagement",
        description: "Agents read the new follow-up question together with the prior conclusion, then issue refreshed positions.",
    },
    5: {
        title: "Follow-up — Updated Critique",
        description: "Agents critique the new responses against the original synthesis to surface what genuinely changed.",
    },
    6: {
        title: "Follow-up — Updated Synthesis & Verdict",
        description: "Each agent issues an updated synthesis, and the moderator publishes a new Overall Verdict for this follow-up cycle.",
    },
};

/**
 * Process Guide step catalogues.
 *
 * The guide is rendered context-aware: when the user is on the base debate
 * (cycle 1, no follow-up exists) we only show the three base steps. As soon
 * as a follow-up cycle exists / is selected, we switch to the follow-up
 * step set so the user is not misled into thinking that follow-up rounds
 * are "missing" or "failed" phases of the base debate.
 */
type ProcessStep = {
    key: string;
    label: string;
    description: string;
    /** Backend round number(s) that satisfy this step. */
    roundNumbers: number[];
};

const BASE_CYCLE_STEPS: ProcessStep[] = [
    {
        key: "initial",
        label: "Initial Proposals",
        description: "Agents establish their starting positions.",
        roundNumbers: [1],
    },
    {
        key: "critique",
        label: "Debate & Critique",
        description: "Agents challenge assumptions and test weak points.",
        roundNumbers: [2],
    },
    {
        key: "final",
        label: "Final Synthesis + Verdict",
        description:
            "Agents synthesize the debate and the moderator produces the overall verdict.",
        roundNumbers: [3],
    },
];

const FOLLOWUP_CYCLE_STEPS: ProcessStep[] = [
    {
        key: "followup_response",
        label: "Follow-up Response",
        description:
            "Agents answer the new follow-up question using the existing debate state.",
        roundNumbers: [4],
    },
    {
        key: "followup_critique",
        label: "Follow-up Critique",
        description: "Agents critique the follow-up answers.",
        roundNumbers: [5],
    },
    {
        key: "updated_synthesis",
        label: "Updated Synthesis + Verdict",
        description:
            "Agents update their synthesis and the moderator provides an updated overall verdict.",
        roundNumbers: [6],
    },
];

const FOLLOWUP_ROUND_TYPES = new Set([
    "followup_response",
    "followup_critique",
    "updated_synthesis",
]);

/**
 * Resolve the *effective* round for a selected node.
 *
 * The graph reuses the same node id (`agent-{id}`) for an agent's Round 1
 * stance and Round 3 final position — so by the time Round 3 is written
 * the node's `round` field is always 3, even if the user is currently
 * focused on Round 1 in the timeline. We therefore prefer:
 *   1. an explicit `selectedRound` from the playback store (user intent),
 *   2. the node's intrinsic round (which is correct for intermediate /
 *      synthesis / follow-up nodes that are NOT shared across rounds).
 */
function effectiveRound(
    node: DebateGraphNode,
    selectedRound: number | null,
): number {
    if (
        selectedRound != null
        && (node.kind === "agent" || node.kind === "followup-agent")
    ) {
        return selectedRound;
    }
    return node.round;
}

/** Human label for a (round, cycle) pair, follow-up aware. */
function roundLabelFor(round: number, cycle: number): string {
    const isFollowUp = cycle > 1;
    const followUpIndex = cycle - 1;
    if (isFollowUp) {
        if (round === 4) return `Follow-up #${followUpIndex} response`;
        if (round === 5) return `Follow-up #${followUpIndex} critique`;
        if (round === 6) return `Follow-up #${followUpIndex} conclusion`;
        return `Follow-up #${followUpIndex} — Round ${round}`;
    }
    if (round === 1) return "Round 1";
    if (round === 2) return "Round 2";
    if (round === 3) return "Round 3";
    return `Round ${round}`;
}

/** Build an interpretive explanation of what a selected node means in the debate. */
function buildNodeInterpretation(
    node: DebateGraphNode,
    edges: DebateGraphEdge[],
    allNodes: DebateGraphNode[],
    selectedRound: number | null,
): { meaning: string; role: string; context: string[] } {
    const relatedEdges = edges.filter(
        (e) => e.source === node.id || e.target === node.id,
    );
    const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    const cycle = node.cycle ?? 1;
    const r = effectiveRound(node, selectedRound);
    const roundLabel = roundLabelFor(r, cycle);

    if (node.kind === "question") {
        return {
            meaning: "This is the central question driving the entire debate. All agent reasoning stems from this prompt.",
            role: "Debate catalyst",
            context: [`${relatedEdges.length} agents are responding to this question.`],
        };
    }

    if (node.kind === "synthesis" || node.kind === "followup-synthesis") {
        const incomingAgents = relatedEdges
            .filter((e) => e.target === node.id)
            .map((e) => allNodes.find((n) => n.id === e.source)?.agentRole)
            .filter((s): s is string => Boolean(s));
        const isFollowUp = cycle > 1;
        return {
            meaning: isFollowUp
                ? "Updated synthesis after the follow-up — combines the original conclusion with new reasoning."
                : "This is the final synthesis — the debate's conclusion that combines the strongest arguments from all rounds.",
            role: isFollowUp
                ? `Updated synthesis — Follow-up #${cycle - 1} conclusion`
                : "Final synthesis — Round 3 conclusion",
            context: incomingAgents.length > 0
                ? [`Integrates perspectives from: ${incomingAgents.map(capitalize).join(", ")}`]
                : ["Combines all agent perspectives into a unified conclusion."],
        };
    }

    if (node.kind === "intermediate" || node.kind === "followup-intermediate") {
        // Critique node — round 2 in the original cycle, round 5 in a follow-up.
        const outgoing = relatedEdges.filter((e) => e.source === node.id);
        const incoming = relatedEdges.filter((e) => e.target === node.id);
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
            role: `${capitalize(node.agentRole ?? "Agent")} — ${roundLabel} participant`,
            context: context.length > 0 ? context : ["Participating in the agent-to-agent debate."],
        };
    }

    // Regular agent node (round 1, round 3, follow-up agent).
    const context: string[] = [];
    const challengeEdges = relatedEdges.filter((e) => e.kind === "challenges");
    const supportEdges = relatedEdges.filter((e) => e.kind === "supports");

    if (challengeEdges.length > 0) {
        context.push(`Involved in ${challengeEdges.length} challenge${challengeEdges.length > 1 ? "s" : ""}`);
    }
    if (supportEdges.length > 0) {
        context.push(`Involved in ${supportEdges.length} support connection${supportEdges.length > 1 ? "s" : ""}`);
    }
    if (context.length === 0 && r === 1) {
        context.push("Presented an initial perspective in Round 1.");
    }

    return {
        meaning: `${capitalize(node.agentRole ?? "Agent")} contributes a ${node.agentRole ?? "general"}-oriented perspective to the debate.`,
        role: `${capitalize(node.agentRole ?? "Agent")} — ${roundLabel} contributor`,
        context,
    };
}

type GuideStepStatus = "completed" | "current" | "pending";

interface ProcessGuideStep extends ProcessStep {
    status: GuideStepStatus;
    localIndex: number;
    backendRoundLabel: string;
}

interface ProcessGuideViewModel {
    mode: "base" | "followup";
    cycleNumber: number;
    cycleTitle: string;
    followupQuestion: string | null;
    steps: ProcessGuideStep[];
    /** Status of the entire guide, used to drive the bottom hint copy. */
    overallStatus: "pending" | "running" | "completed";
    /** Whether the base debate has already produced any follow-up rounds. */
    hasFollowupCycles: boolean;
}

type SessionLike = {
    latest_turn?: {
        rounds?: Array<{
            round_type?: string;
            round_number?: number;
            cycle_number?: number | null;
            messages?: Array<{ payload?: Record<string, unknown> }>;
        }> | null;
        follow_ups?: Array<{ cycle_number: number; question: string }> | null;
    } | null;
} | null | undefined;

function detectFollowupCycles(session: SessionLike): boolean {
    const turn = session?.latest_turn;
    if (!turn) return false;
    if ((turn.follow_ups?.length ?? 0) > 0) return true;
    for (const r of turn.rounds ?? []) {
        if (r.round_type && FOLLOWUP_ROUND_TYPES.has(r.round_type)) return true;
        if ((r.cycle_number ?? 1) > 1) return true;
        for (const m of r.messages ?? []) {
            const p = m.payload;
            if (p && typeof p === "object") {
                if ("followup_question" in p || "followup_cycle" in p) return true;
            }
        }
    }
    return false;
}

function buildProcessGuide(args: {
    session: SessionLike;
    selectedCycle: number;
    selectedRound: number | null;
    activeRound: number;
    debateStatus: string;
}): ProcessGuideViewModel {
    const { session, selectedCycle, selectedRound, activeRound, debateStatus } = args;
    const turn = session?.latest_turn ?? null;
    const rounds = turn?.rounds ?? [];

    const hasFollowupCycles = detectFollowupCycles(session);
    const cycleNumber = Math.max(1, selectedCycle || 1);
    const isFollowupMode = cycleNumber > 1 || (hasFollowupCycles && selectedCycle > 1);

    // Resolve which rounds belong to the cycle we're rendering. Round
    // records carry an explicit `cycle_number`; if missing, fall back to
    // round_type-based grouping (cycle 1 = initial/critique/final, every
    // follow-up cycle = followup_response/followup_critique/updated_synthesis).
    const roundsInCycle = rounds.filter((r) => {
        const c = r.cycle_number ?? 1;
        if (c === cycleNumber) return true;
        if (cycleNumber === 1 && r.cycle_number == null) {
            return !r.round_type || !FOLLOWUP_ROUND_TYPES.has(r.round_type);
        }
        return false;
    });

    const stepDefs = isFollowupMode ? FOLLOWUP_CYCLE_STEPS : BASE_CYCLE_STEPS;

    const isStepCompleted = (step: ProcessStep): boolean => {
        // A step is "completed" if any matching round has at least one
        // agent/judge message recorded.
        const matchingRounds = roundsInCycle.filter((r) =>
            step.roundNumbers.includes(r.round_number ?? -1),
        );
        for (const r of matchingRounds) {
            if ((r.messages?.length ?? 0) > 0) return true;
        }
        return false;
    };

    // Live round detection: only meaningful when we're on the live cycle.
    const isLiveCycle =
        (debateStatus === "queued" || debateStatus === "running") &&
        cycleNumber === (selectedCycle || 1);
    const referenceRound = selectedRound ?? activeRound ?? 0;

    const steps: ProcessGuideStep[] = stepDefs.map((step, idx) => {
        const completed = isStepCompleted(step);
        let status: GuideStepStatus;
        if (completed) {
            status = "completed";
        } else if (
            isLiveCycle &&
            step.roundNumbers.includes(referenceRound)
        ) {
            status = "current";
        } else {
            status = "pending";
        }
        return {
            ...step,
            status,
            localIndex: idx + 1,
            backendRoundLabel:
                step.roundNumbers.length === 1
                    ? `Round ${step.roundNumbers[0]}`
                    : `Rounds ${step.roundNumbers.join(", ")}`,
        };
    });

    const allCompleted = steps.every((s) => s.status === "completed");
    const anyCompleted = steps.some((s) => s.status === "completed");
    const overallStatus: "pending" | "running" | "completed" = allCompleted
        ? "completed"
        : isLiveCycle || anyCompleted
            ? "running"
            : "pending";

    const followupQuestion = isFollowupMode
        ? turn?.follow_ups?.find((f) => f.cycle_number === cycleNumber)?.question ?? null
        : null;

    const cycleTitle = isFollowupMode
        ? `Cycle ${cycleNumber} — Follow-up`
        : `Cycle ${cycleNumber}`;

    return {
        mode: isFollowupMode ? "followup" : "base",
        cycleNumber,
        cycleTitle,
        followupQuestion,
        steps,
        overallStatus,
        hasFollowupCycles,
    };
}

export default function ModeratorPanel() {
    const status = useModeratorStore((s) => s.status);
    const explanation = useModeratorStore((s) => s.explanation);
    const watchFor = useModeratorStore((s) => s.watchFor);
    const activityFeed = useModeratorStore((s) => s.activityFeed);
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const selectedCycle = usePlaybackStore((s) => s.selectedCycle);
    const setSelectedRound = usePlaybackStore((s) => s.setSelectedRound);
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);
    const setFocus = useGraphStore((s) => s.setFocus);
    const currentStepDescription = useAnimationStore((s) => s.currentStepDescription);
    const executionMode = useDebateStore((s) => s.executionMode);
    const currentlyGenerating = useDebateStore((s) => s.currentlyGenerating);
    const pendingStep = useDebateStore((s) => s.pendingStep);
    const turnStatus = useDebateStore((s) => s.turnStatus);
    const requestNextStep = useDebateStore((s) => s.requestNextStep);
    const enableAutoRun = useDebateStore((s) => s.enableAutoRun);
    const stepBusy = useDebateStore((s) => s.stepBusy);
    const stepError = useDebateStore((s) => s.stepError);
    const playbackMode = useDebateStore((s) => s.playbackMode);
    const playbackQueue = useDebateStore((s) => s.playbackQueue);
    const revealedNodeIds = useDebateStore((s) => s.revealedNodeIds);
    const setPlaybackMode = useDebateStore((s) => s.setPlaybackMode);
    const revealNextVisual = useDebateStore((s) => s.revealNextVisual);
    const session = useDebateStore((s) => s.session);
    const execution = useDebateExecutionState();

    const processGuide = useMemo(
        () =>
            buildProcessGuide({
                session,
                selectedCycle,
                selectedRound,
                activeRound: execution.activeRound,
                debateStatus: execution.debateStatus,
            }),
        [session, selectedCycle, selectedRound, execution.activeRound, execution.debateStatus],
    );

    const queuedForReveal = playbackQueue.length;
    const revealedStepCount = revealedNodeIds.filter((id) => id !== "question-node").length;

    const canClickNext =
        !stepBusy
        && currentlyGenerating === null
        && (execution.debateStatus === "queued" || execution.debateStatus === "running");

    /**
     * roundInfo only drives the *supplementary* "Why this matters" block.
     * It must NOT override the primary explanation — otherwise picking
     * Round 3 in the timeline while Round 1 is executing would make the
     * panel narrate Round 3, which is the bug we're fixing.
     */
    const roundInfo = selectedRound ? roundExplanations[selectedRound] : null;
    const displayExplanation = explanation;

    /**
     * Whether the user is "viewing" something other than the live state.
     * In that case we show a small secondary chip in the header so they
     * know the panel content reflects the live execution, not their pick.
     */
    const isLive =
        execution.debateStatus === "queued" || execution.debateStatus === "running";
    const viewingOlderRound =
        selectedRound !== null && isLive && selectedRound !== execution.activeRound;
    const viewingOlderCycle = selectedCycle > 1 && isLive;

    // Find selected node data for interpretation mode
    const selectedNode = selectedNodeId
        ? graph.nodes.find((n) => n.id === selectedNodeId)
        : null;

    const isInterpretationMode = selectedNode !== null;

    const interpretation = selectedNode
        ? buildNodeInterpretation(selectedNode, graph.edges, graph.nodes, selectedRound)
        : null;

    const handleActivityClick = (relatedNodeId?: string) => {
        if (relatedNodeId) {
            selectNode(relatedNodeId);
            setFocus(relatedNodeId);
        }
    };

    return (
        <div className="w-full h-full bg-agora-surface/40 flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-agora-border space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                        Moderator
                    </h2>
                    <span
                        className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide",
                            status === "Live"
                                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                : status === "Completed"
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : status === "Failed"
                                        ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                        : "bg-gray-500/20 text-gray-300 border border-gray-500/30",
                        )}
                        title="Live debate execution status"
                    >
                        {isLive
                            ? `Live · Round ${execution.activeRound}`
                            : status}
                    </span>
                </div>

                {(viewingOlderRound || viewingOlderCycle) && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-agora-text-muted/80">Viewing:</span>
                        {viewingOlderCycle && (
                            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 border border-violet-500/30">
                                Follow-up #{selectedCycle - 1}
                            </span>
                        )}
                        {viewingOlderRound && (
                            <button
                                type="button"
                                onClick={() => setSelectedRound(null)}
                                className="px-1.5 py-0.5 rounded bg-agora-surface-light/60 text-agora-text hover:bg-agora-surface-light border border-agora-border"
                                title="Clear round filter"
                            >
                                Round {selectedRound} ✕
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Process Guide (context-aware: base or follow-up) ─── */}
            {!isInterpretationMode && (
                <div className="px-4 py-3 border-b border-agora-border bg-violet-500/5">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">
                            Process Guide
                        </div>
                        <span className="text-[10px] text-agora-text-muted">
                            {processGuide.cycleTitle}
                        </span>
                    </div>

                    {processGuide.mode === "followup" && processGuide.followupQuestion && (
                        <p
                            className="text-[11px] italic text-violet-200/80 mb-2 line-clamp-2"
                            title={processGuide.followupQuestion}
                        >
                            Follow-up question: “{processGuide.followupQuestion}”
                        </p>
                    )}

                    <ol className="space-y-1">
                        {processGuide.steps.map((step) => {
                            const isCurrent = step.status === "current";
                            const isCompleted = step.status === "completed";
                            return (
                                <li
                                    key={step.key}
                                    className={cn(
                                        "flex items-start gap-2 text-[11px] leading-snug",
                                        isCurrent
                                            ? "text-white"
                                            : isCompleted
                                                ? "text-agora-text-muted/80"
                                                : "text-agora-text-muted/60",
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "mt-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-semibold border shrink-0",
                                            isCurrent
                                                ? "bg-violet-500 text-white border-violet-300"
                                                : isCompleted
                                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                                    : "bg-agora-surface-light/40 text-agora-text-muted border-agora-border",
                                        )}
                                    >
                                        {isCompleted ? "✓" : step.localIndex}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div
                                            className={cn(
                                                "font-medium flex items-center justify-between gap-2",
                                                isCurrent && "text-white",
                                            )}
                                        >
                                            <span className="truncate">{step.label}</span>
                                            <span className="text-[9px] uppercase tracking-wide text-agora-text-muted/60 font-normal shrink-0">
                                                {step.backendRoundLabel}
                                            </span>
                                        </div>
                                        {isCurrent && (
                                            <div className="text-[10px] text-violet-200/90 mt-0.5">
                                                {step.description}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>

                    {/* Bottom hint — depends on mode + completion state.       */}
                    {processGuide.mode === "base" && processGuide.overallStatus === "completed" && !processGuide.hasFollowupCycles && (
                        <div className="mt-2.5 pt-2.5 border-t border-agora-border/40 space-y-1">
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                                Follow-up
                            </div>
                            <p className="text-[11px] text-agora-text leading-relaxed">
                                Ask a follow-up question to continue the debate.
                            </p>
                            <p className="text-[10px] text-agora-text-muted/80 leading-relaxed">
                                Follow-up cycles will add response, critique, and updated synthesis rounds.
                            </p>
                        </div>
                    )}
                    {processGuide.mode === "followup" && processGuide.overallStatus === "completed" && (
                        <p className="mt-2.5 pt-2.5 border-t border-agora-border/40 text-[11px] text-agora-text-muted leading-relaxed">
                            Follow-up cycle complete. Review the Updated Overall Verdict or ask another follow-up question.
                        </p>
                    )}
                </div>
            )}

            {/* ── Guided Narrator ─────────────────────────────────── */}
            {!isInterpretationMode && (execution.debateStatus === "queued" || execution.debateStatus === "running" || (execution.debateStatus === "completed" && queuedForReveal > 0)) && (
                <div className="px-4 py-3 border-b border-agora-border bg-indigo-500/5 space-y-2.5">
                    {/* Current Step */}
                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-1">
                            Current Step
                        </div>
                        {(() => {
                            // Backend-derived live state takes priority for UX text.
                            if (currentlyGenerating) {
                                return (
                                    <p className="text-xs text-white leading-relaxed">
                                        Round {currentlyGenerating.round_number} —{" "}
                                        <span className="font-semibold capitalize">{currentlyGenerating.agent_role || "agent"}</span>{" "}
                                        is generating a response…
                                    </p>
                                );
                            }
                            if (turnStatus === "completed" && queuedForReveal > 0) {
                                return (
                                    <p className="text-xs text-white leading-relaxed">
                                        Debate generation is complete. Continue revealing the remaining responses.
                                    </p>
                                );
                            }
                            if (queuedForReveal > 0 && playbackMode === "paused") {
                                return (
                                    <p className="text-xs text-white leading-relaxed">
                                        A new response is ready. Click <strong>Next Step</strong> to reveal it.
                                        <span className="ml-1 text-agora-text-muted">({queuedForReveal} queued)</span>
                                    </p>
                                );
                            }
                            if (queuedForReveal > 0 && playbackMode === "auto") {
                                return (
                                    <p className="text-xs text-white leading-relaxed">
                                        Auto Run is revealing responses as they arrive.
                                    </p>
                                );
                            }
                            if (revealedStepCount === 0) {
                                return (
                                    <p className="text-xs text-white leading-relaxed">
                                        Waiting for the first agent response...
                                    </p>
                                );
                            }
                            return (
                                <p className="text-xs text-agora-text-muted leading-relaxed">
                                    {currentStepDescription || "Generating next round response..."}
                                </p>
                            );
                        })()}
                    </div>

                    {/* Why this matters */}
                    {roundInfo && (
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                                Why this matters
                            </div>
                            <p className="text-[11px] text-agora-text-muted leading-relaxed">
                                {roundInfo.description}
                            </p>
                        </div>
                    )}

                    {/* Latest result */}
                    {activityFeed.length > 0 && (
                        <div>
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                                Latest result
                            </div>
                            <p className="text-[11px] text-agora-text leading-relaxed line-clamp-2">
                                {activityFeed[activityFeed.length - 1]?.text ?? "—"}
                            </p>
                        </div>
                    )}

                    {/* Playback controls (frontend-only) */}
                    <div className="pt-1 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            {playbackMode === "auto" ? (
                                <button
                                    type="button"
                                    onClick={() => setPlaybackMode("paused")}
                                    className="flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-400 transition-colors"
                                    title="Pause visual reveal only (backend keeps generating)"
                                >
                                    ⏸ Pause
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setPlaybackMode("auto")}
                                    className="flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-400 transition-colors"
                                    title="Enable Auto Run visual playback"
                                >
                                    ▶ Auto Run
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => revealNextVisual()}
                                disabled={queuedForReveal === 0}
                                className="flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                title={queuedForReveal === 0
                                    ? "No queued responses \u2014 waiting for backend"
                                    : "Reveal the next queued response"}
                            >
                                Next Step ▶{queuedForReveal > 0 && (
                                    <span className="ml-1 text-[10px] opacity-80">({queuedForReveal})</span>
                                )}
                            </button>
                        </div>

                        {/* Backend manual gate: dev/experimental only */}
                        {import.meta.env.DEV && executionMode === "manual" && (
                            <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-agora-border/40">
                                <span className="text-[9px] uppercase tracking-wider text-amber-400/80">
                                    dev:
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void requestNextStep()}
                                    disabled={!canClickNext || pendingStep === null}
                                    className="flex-1 px-2 py-1 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {currentlyGenerating
                                        ? "Generating…"
                                        : pendingStep
                                            ? "Release backend gate"
                                            : "No gate active"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void enableAutoRun()}
                                    className="px-2 py-1 rounded text-[10px] font-medium border border-agora-border text-agora-text-muted hover:text-white"
                                >
                                    Auto
                                </button>
                            </div>
                        )}

                        {stepError && (
                            <p className="text-[10px] text-red-400 truncate" title={stepError}>
                                {stepError}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Completed-debate banner */}
            {!isInterpretationMode && turnStatus === "completed" && (
                <div className="px-4 py-3 border-b border-agora-border bg-emerald-500/5">
                    <p className="text-xs text-emerald-200 leading-relaxed">
                        {processGuide.mode === "followup"
                            ? "Follow-up cycle complete. Review the Updated Overall Verdict or ask another follow-up question."
                            : "Debate complete. Review the Overall Synthesis Verdict or ask a follow-up question to continue."}
                    </p>
                </div>
            )}

            {/* Current Step Description */}
            {currentStepDescription && !isInterpretationMode && (turnStatus !== "queued" && turnStatus !== "running") && (
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
