import { useMemo, useState } from "react";
import AgoraLogoIcon from "./AgoraLogoIcon";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import { useDebateStore } from "../model/debate.store";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import { useGraphStore } from "../model/graph.store";
import { deriveActiveNarration } from "../model/execution-ux";

export default function TopTopicBar() {
    const navigate = useNavigate();
    const session = useDebateStore((s) => s.session);
    const agents = useDebateStore((s) => s.agents);
    const graph = useGraphStore((s) => s.graph);
    const execution = useDebateExecutionState();
    const [questionExpanded, setQuestionExpanded] = useState(false);

    const narration = useMemo(
        () => deriveActiveNarration({
            execution,
            agents,
            nodes: graph.nodes,
            edges: graph.edges,
        }),
        [execution, agents, graph.nodes, graph.edges],
    );

    const statusColor: Record<string, string> = {
        queued: "bg-amber-500/20 text-amber-400 border-amber-500/30",
        running: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
        completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        failed: "bg-red-500/20 text-red-400 border-red-500/30",
    };

    const statusLabel = execution.debateStatus.toUpperCase();
    const stageLabel =
        execution.debateStatus === "running"
            ? `Round ${execution.activeRound}`
            : execution.debateStatus === "queued"
                ? "Round 1"
                : execution.debateStatus === "completed"
                    ? "All Rounds"
                    : `Round ${execution.activeRound}`;

    const fullQuestion = session?.question ?? "No debate loaded";

    return (
        <>
            <div className="h-14 px-4 flex items-center gap-3 border-b border-agora-border bg-agora-surface/80 backdrop-blur-sm">

                {/* Left — back + logo (fixed, never shrinks) */}
                <div className="flex items-center gap-3 shrink-0">
                    <button
                        onClick={() => navigate("/debates")}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-all whitespace-nowrap"
                        title="Back to all debates"
                    >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        All Debates
                    </button>

                    <div className="h-5 w-px bg-agora-border" />

                    <div className="flex items-center gap-2">
                        <AgoraLogoIcon size={32} />
                        <span className="text-sm font-semibold text-white">AGORA</span>
                    </div>
                </div>

                <div className="h-5 w-px bg-agora-border shrink-0" />

                {/* Center — question text (takes all available space) */}
                <button
                    type="button"
                    title={fullQuestion}
                    onClick={() => setQuestionExpanded(true)}
                    className="flex-1 min-w-0 text-left text-sm text-agora-text-muted hover:text-white transition-colors"
                >
                    <span className="truncate block">{fullQuestion}</span>
                </button>

                <div className="h-5 w-px bg-agora-border shrink-0" />

                {/* Right — status + meta (fixed, never shrinks) */}
                <div className="flex items-center gap-3 shrink-0">
                    {execution.debateStatus && (
                        <span
                            className={cn(
                                "px-2.5 py-0.5 rounded-full text-[11px] font-medium border uppercase tracking-wider whitespace-nowrap",
                                statusColor[execution.debateStatus] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30",
                            )}
                        >
                            {execution.debateStatus === "running" && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse" />
                            )}
                            {statusLabel}
                        </span>
                    )}

                    <span className="hidden lg:inline text-[11px] text-agora-text-muted whitespace-nowrap">
                        {stageLabel}
                    </span>

                    {execution.debateStatus === "running" && narration.relation && (
                        <span className="hidden xl:inline text-[11px] text-indigo-300/90 truncate max-w-[180px]">
                            {narration.relation}
                        </span>
                    )}

                    {session?.agents && (
                        <span className="hidden md:inline text-[11px] text-agora-text-muted whitespace-nowrap">
                            {session.agents.length} agents
                        </span>
                    )}
                </div>
            </div>

            {questionExpanded && (
                <div
                    className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
                    onClick={() => setQuestionExpanded(false)}
                >
                    <div
                        className="w-full max-w-2xl rounded-2xl border border-agora-border bg-agora-surface shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-agora-border flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">Debate question</h3>
                            <button
                                type="button"
                                onClick={() => setQuestionExpanded(false)}
                                className="w-8 h-8 rounded-lg bg-agora-surface-light flex items-center justify-center text-agora-text-muted hover:text-white hover:bg-gray-600 transition-colors"
                                aria-label="Close question dialog"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="px-5 py-4">
                            <p className="text-sm text-white leading-relaxed whitespace-pre-wrap break-words">{fullQuestion}</p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
