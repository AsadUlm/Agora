/**
 * DebateStepTimeline — shows the 5-stage debate pipeline as a live tracker.
 *
 * Running mode:  current stage highlighted + live activity messages.
 * Completed mode: step summary with count badges per stage.
 *
 * Used inside DebateOverviewPanel and also standalone in DebateTimeline (left sidebar).
 */
import { cn } from "@/shared/lib/cn";
import { useDebateViewState } from "../model/useDebateViewState";
import type { DebateStage, StageStatus } from "../model/execution-state";

const STAGE_ICONS: Record<string, string> = {
    initial: "🎯",
    critique: "⚔️",
    critique_response: "💬",
    revised_position: "🔄",
    final: "🏆",
};

const STATUS_COLORS: Record<StageStatus, string> = {
    completed: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
    running: "bg-indigo-500/20 border-indigo-500/50 text-indigo-200 ring-1 ring-indigo-400/30",
    waiting: "bg-white/5 border-white/15 text-white/50",
    locked: "bg-transparent border-transparent text-white/25 opacity-50",
    failed: "bg-red-500/10 border-red-500/30 text-red-300",
    partially_completed: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    skipped: "bg-white/5 border-white/10 text-white/30",
};

const DOT_COLORS: Record<StageStatus, string> = {
    completed: "bg-emerald-400",
    running: "bg-indigo-400 animate-pulse",
    waiting: "bg-white/20",
    locked: "bg-white/10",
    failed: "bg-red-400",
    partially_completed: "bg-amber-400",
    skipped: "bg-white/20",
};

// ── Single stage row ──────────────────────────────────────────────────────────

function StageRow({
    stage,
    isLast,
    compact = false,
}: {
    stage: DebateStage;
    isLast: boolean;
    compact?: boolean;
}) {
    const isRunning = stage.status === "running";
    const isCompleted = stage.status === "completed";
    const isLocked = stage.status === "locked";
    const countLabel =
        stage.roundType === "final" && isCompleted
            ? "done"
            : isCompleted
                ? `${stage.completedCount}/${stage.totalCount}`
                : isRunning
                    ? `${stage.completedCount}/${stage.totalCount}…`
                    : "";

    return (
        <div className="flex gap-2.5">
            {/* Connector line column */}
            <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
                <div className={cn("w-2 h-2 rounded-full shrink-0 mt-1", DOT_COLORS[stage.status])} />
                {!isLast && <div className="flex-1 w-px bg-white/10 my-0.5" />}
            </div>

            {/* Content */}
            <div className={cn("pb-3 flex-1 min-w-0", isLast ? "pb-0" : "")}>
                <div
                    className={cn(
                        "flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors",
                        STATUS_COLORS[stage.status],
                    )}
                >
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("text-sm shrink-0", isLocked ? "grayscale opacity-40" : "")}>
                            {STAGE_ICONS[stage.roundType] ?? "📌"}
                        </span>
                        <div className="min-w-0">
                            <p className={cn("text-[11px] font-semibold leading-tight truncate", isLocked ? "text-white/20" : "")}>
                                Stage {stage.index}: {stage.shortLabel}
                            </p>
                            {isRunning && stage.generatingAgentRole && (
                                <p className="text-[10px] text-indigo-300/80 mt-0.5 truncate">
                                    {stage.generatingAgentRole} is generating…
                                </p>
                            )}
                        </div>
                    </div>
                    {countLabel && (
                        <span className={cn("text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded", isCompleted ? "bg-emerald-500/20" : "bg-white/10")}>
                            {countLabel}
                        </span>
                    )}
                </div>

                {/* Activity messages (running mode) */}
                {isRunning && !compact && stage.activityMessages.length > 0 && (
                    <div className="mt-1.5 pl-1 space-y-0.5">
                        {stage.activityMessages.map((msg, i) => (
                            <p key={i} className="text-[10px] text-white/50 leading-tight">
                                ✓ {msg}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DebateStepTimelineProps {
    compact?: boolean;
}

export default function DebateStepTimeline({ compact = false }: DebateStepTimelineProps) {
    const view = useDebateViewState();
    const execution = view.execution;

    if (!execution.is5Stage || !execution.stages) {
        return null;
    }

    const { stages, debateStatus, activeStage } = execution;
    const isRunning = debateStatus === "running";
    const isCompleted = debateStatus === "completed";

    return (
        <div className="space-y-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">
                    {isRunning ? "Live Debate Progress" : "Debate Pipeline"}
                </p>
                {isCompleted && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Complete
                    </span>
                )}
                {isRunning && activeStage != null && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse">
                        Stage {activeStage} / 5
                    </span>
                )}
            </div>

            {/* Stage rows */}
            <div>
                {stages.map((stage, i) => (
                    <StageRow
                        key={stage.index}
                        stage={stage}
                        isLast={i === stages.length - 1}
                        compact={compact}
                    />
                ))}
            </div>

            {/* Running hint */}
            {isRunning && (
                <p className="mt-2 text-[10px] text-white/30 italic">
                    Updates automatically as each stage completes.
                </p>
            )}
        </div>
    );
}
