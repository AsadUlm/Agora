import { useMemo } from "react";
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

    return (
        <div className="h-14 px-6 flex items-center justify-between border-b border-agora-border bg-agora-surface/80 backdrop-blur-sm">
            <div className="flex items-center gap-4">
                {/* Back to Debates */}
                <button
                    onClick={() => navigate("/debates")}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-all"
                    title="Back to all debates"
                >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    All Debates
                </button>

                <div className="h-5 w-px bg-agora-border" />

                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                        A
                    </div>
                    <span className="text-sm font-semibold text-white">AGORA</span>
                </div>

                <div className="h-5 w-px bg-agora-border" />

                <div className="text-sm text-agora-text-muted truncate max-w-[500px]">
                    {session?.question ?? "No debate loaded"}
                </div>
            </div>

            <div className="flex items-center gap-3">
                {execution.debateStatus && (
                    <span
                        className={cn(
                            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border uppercase tracking-wider",
                            statusColor[execution.debateStatus] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30",
                        )}
                    >
                        {execution.debateStatus === "running" && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse" />
                        )}
                        {statusLabel}
                    </span>
                )}

                <span className="text-[11px] text-agora-text-muted">
                    {stageLabel}
                </span>

                {execution.debateStatus === "running" && (
                    <span className="text-[11px] text-indigo-300/90 truncate max-w-[260px]">
                        {narration.relation ?? narration.title}
                    </span>
                )}

                {session?.agents && (
                    <span className="text-[11px] text-agora-text-muted">
                        {session.agents.length} agents
                    </span>
                )}
            </div>
        </div>
    );
}
