import { useMemo } from "react";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import { useDebateStore } from "../model/debate.store";
import { useGraphStore } from "../model/graph.store";
import { deriveActiveNarration } from "../model/execution-ux";

export default function PlaybackBar() {
    const execution = useDebateExecutionState();
    const agents = useDebateStore((s) => s.agents);
    const graph = useGraphStore((s) => s.graph);
    const executionMode = useDebateStore((s) => s.executionMode);
    const currentlyGenerating = useDebateStore((s) => s.currentlyGenerating);
    const pendingStep = useDebateStore((s) => s.pendingStep);
    const stepBusy = useDebateStore((s) => s.stepBusy);
    const stepError = useDebateStore((s) => s.stepError);
    const requestNextStep = useDebateStore((s) => s.requestNextStep);
    const enableAutoRun = useDebateStore((s) => s.enableAutoRun);

    const playbackMode = useDebateStore((s) => s.playbackMode);
    const playbackQueue = useDebateStore((s) => s.playbackQueue);
    const revealedNodeIds = useDebateStore((s) => s.revealedNodeIds);
    const canonicalNodeCount = useDebateStore((s) => s.canonicalNodeCount);
    const renderedNodeCount = useDebateStore((s) => s.renderedNodeCount);
    const lastWsEventType = useDebateStore((s) => s.lastWsEventType);
    const setPlaybackMode = useDebateStore((s) => s.setPlaybackMode);
    const revealNextVisual = useDebateStore((s) => s.revealNextVisual);

    const isRunning = execution.debateStatus === "running";
    const isQueued = execution.debateStatus === "queued";
    const isFailed = execution.debateStatus === "failed";
    const isCompleted = execution.debateStatus === "completed";
    const currentRound = execution.rounds.find((round) => round.roundNumber === execution.activeRound);

    const playbackQueueLength = playbackQueue.length;
    const generatedCount = useMemo(
        () =>
            graph.nodes.filter(
                (node) =>
                    node.id !== "question-node"
                    && node.status !== "hidden",
            ).length,
        [graph.nodes],
    );
    const revealedStepCount = useMemo(
        () => revealedNodeIds.filter((id) => id !== "question-node").length,
        [revealedNodeIds],
    );
    const queuedCount = Math.max(0, generatedCount - revealedStepCount);

    const narration = useMemo(
        () => deriveActiveNarration({
            execution,
            agents,
            nodes: graph.nodes,
            edges: graph.edges,
        }),
        [execution, agents, graph.nodes, graph.edges],
    );

    const stageLabel = isCompleted
        ? "Debate Complete"
        : isFailed
            ? "Debate Failed"
            : `Round ${execution.activeRound}: ${currentRound?.label ?? "In Progress"}`;

    const barColor = isFailed
        ? "from-red-500 to-rose-500"
        : isCompleted
            ? "from-emerald-500 to-teal-500"
            : "from-indigo-500 to-purple-500";

    // Backend manual mode is dev-only. In normal flow execution_mode is
    // "auto" and Next Step / Pause control frontend playback only.
    const showBackendManualUI = import.meta.env.DEV && executionMode === "manual";
    const canBackendNext = pendingStep !== null && !stepBusy && currentlyGenerating === null;

    const canRevealNext = playbackQueueLength > 0;
    const showPlaybackControls = isRunning || isQueued;

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
                        Generating: {execution.currentAgentRole}
                    </div>
                )}

                {isCompleted && (
                    <div className="text-[11px] text-emerald-300 truncate">
                        Final synthesis stabilized
                    </div>
                )}

                <div className="text-[10px] text-agora-text-muted mt-0.5">
                    Generated: {generatedCount}
                    {" · "}Shown: {revealedStepCount}
                    {" · "}Queue: {showPlaybackControls ? playbackQueueLength : queuedCount}
                </div>

                {isFailed && (
                    <div className="text-[11px] text-red-300 truncate mt-0.5">
                        {execution.failureMessage || "Execution failed"}
                    </div>
                )}
            </div>

            {/* ── Frontend playback controls ─────────────────────────── */}
            {showPlaybackControls && (
                <div className="flex flex-col items-end gap-1 pl-4 border-l border-agora-border">
                    <div className="flex items-center gap-2">
                        {playbackMode === "auto" ? (
                            <button
                                type="button"
                                onClick={() => setPlaybackMode("paused")}
                                className="px-3 py-1.5 rounded-md text-[11px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-400 transition-colors"
                                title="Pause visual playback (backend continues generating)"
                            >
                                ⏸ Pause
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setPlaybackMode("auto")}
                                className="px-3 py-1.5 rounded-md text-[11px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-400 transition-colors"
                                title="Enable Auto Run to reveal queued responses automatically"
                            >
                                ▶ Auto Run
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => revealNextVisual()}
                            disabled={!canRevealNext}
                            className="px-4 py-1.5 rounded-md text-xs font-semibold bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title={canRevealNext
                                ? "Reveal the next queued node"
                                : "No queued responses \u2014 waiting for backend to generate"}
                        >
                            Next Step ▶
                            {playbackQueueLength > 0 && (
                                <span className="ml-1.5 text-[10px] opacity-80">
                                    ({playbackQueueLength})
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Backend manual gate (dev/experimental only) */}
                    {showBackendManualUI && (
                        <div className="flex items-center gap-2 mt-1 pt-1 border-t border-agora-border/50">
                            <span className="text-[9px] uppercase tracking-wider text-amber-400/80">
                                dev: backend gate
                            </span>
                            <button
                                type="button"
                                onClick={() => void requestNextStep()}
                                disabled={!canBackendNext}
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {currentlyGenerating
                                    ? "Generating…"
                                    : pendingStep
                                        ? `Release ${pendingStep.agent_role || "step"}`
                                        : stepBusy
                                            ? "Sending…"
                                            : "Idle"}
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
                        <div className="text-[10px] text-red-400 max-w-[220px] text-right truncate" title={stepError}>
                            {stepError}
                        </div>
                    )}
                </div>
            )}

            {import.meta.env.DEV && (
                <div className="text-[9px] text-agora-text-muted/70 font-mono pl-3 border-l border-agora-border whitespace-nowrap">
                    canon {canonicalNodeCount} · rendered {renderedNodeCount} · revealed {revealedStepCount} · queue {playbackQueueLength} · pb {playbackMode}
                    {" · "}backend {execution.debateStatus}
                    {lastWsEventType ? <> · last {lastWsEventType}</> : null}
                    {currentlyGenerating && (
                        <> · gen R{currentlyGenerating.round_number} {currentlyGenerating.agent_role}</>
                    )}
                </div>
            )}
        </div>
    );
}

