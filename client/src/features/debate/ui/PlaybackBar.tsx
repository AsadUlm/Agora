import { useMemo } from "react";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import { useDebateStore } from "../model/debate.store";
import { useGraphStore } from "../model/graph.store";
import { deriveActiveNarration } from "../model/execution-ux";

export default function PlaybackBar() {
    const execution = useDebateExecutionState();
    const agents = useDebateStore((s) => s.agents);
    const graph = useGraphStore((s) => s.graph);

    const isRunning = execution.debateStatus === "running";
    const isQueued = execution.debateStatus === "queued";
    const isFailed = execution.debateStatus === "failed";
    const currentRound = execution.rounds.find((round) => round.roundNumber === execution.activeRound);

    const narration = useMemo(
        () => deriveActiveNarration({
            execution,
            agents,
            nodes: graph.nodes,
            edges: graph.edges,
        }),
        [execution, agents, graph.nodes, graph.edges],
    );

    const stageLabel = execution.debateStatus === "completed"
        ? "Debate Complete"
        : execution.debateStatus === "failed"
            ? "Debate Failed"
            : `Round ${execution.activeRound}: ${currentRound?.label ?? "In Progress"}`;

    const barColor = isFailed
        ? "from-red-500 to-rose-500"
        : execution.debateStatus === "completed"
            ? "from-emerald-500 to-teal-500"
            : "from-indigo-500 to-purple-500";

    return (
        <div className="h-16 px-6 border-t border-agora-border bg-agora-surface/80 backdrop-blur-sm flex items-center gap-5">
            <div className="min-w-[310px]">
                <div className="text-xs font-semibold text-white truncate">
                    {stageLabel}
                </div>
                <div className="text-[11px] text-agora-text-muted truncate">
                    {narration.sublabel}
                </div>
            </div>

            <div className="flex-1">
                <div className="h-2 bg-agora-surface-light rounded-full overflow-hidden">
                    <div
                        className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-400`}
                        style={{ width: `${execution.progress.percentage}%` }}
                    />
                </div>
            </div>

            <div className="min-w-[230px] text-right">
                {(isQueued || isRunning) && narration.relation && (
                    <div className="text-[11px] text-indigo-300/95 truncate">
                        {narration.relation}
                    </div>
                )}

                {(isQueued || isRunning) && !narration.relation && execution.currentAgentRole && (
                    <div className="text-[11px] text-indigo-300/90 truncate">
                        {isRunning ? "Generating" : "Next"}: {execution.currentAgentRole}
                    </div>
                )}

                {execution.debateStatus === "completed" && (
                    <div className="text-[11px] text-emerald-300 truncate">
                        Final synthesis stabilized
                    </div>
                )}

                <div className="text-[10px] text-agora-text-muted mt-0.5">
                    {execution.progress.completedSteps} / {execution.progress.totalSteps} steps ({execution.progress.percentage}%)
                </div>

                {isFailed && (
                    <div className="text-[11px] text-red-300 truncate mt-0.5">
                        {execution.failureMessage || "Execution failed"}
                    </div>
                )}
            </div>
        </div>
    );
}
