import { cn } from "@/shared/lib/cn";
import { motion } from "motion/react";
import { useEffect } from "react";
import { usePlaybackStore } from "../model/playback.store";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import CycleNavigator from "./CycleNavigator";

const phaseIcons: Record<string, string> = {
    initial: "💬",
    critique: "⚔️",
    final: "✨",
};

const statusDotColors: Record<string, string> = {
    locked: "bg-gray-700",
    waiting: "bg-gray-500",
    running: "bg-indigo-400 animate-pulse",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
};

export default function DebateTimeline() {
    const execution = useDebateExecutionState();
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const setSelectedRound = usePlaybackStore((s) => s.setSelectedRound);

    const rounds = execution.rounds.map((round) => ({
        ...round,
        roundType:
            round.roundNumber === 1
                ? "initial"
                : round.roundNumber === 2
                    ? "critique"
                    : "final",
    }));

    useEffect(() => {
        if (selectedRound === null) return;
        const selected = rounds.find((r) => r.roundNumber === selectedRound);
        if (!selected || selected.status === "locked") {
            setSelectedRound(null);
        }
    }, [rounds, selectedRound, setSelectedRound]);

    const handleRoundClick = (roundNumber: number) => {
        const round = rounds.find((r) => r.roundNumber === roundNumber);
        if (!round) return;
        const clickable =
            round.status === "running" ||
            round.status === "completed" ||
            round.status === "failed";
        if (!clickable) return;

        // Toggle: if already selected, deselect (show all)
        if (selectedRound === roundNumber) {
            setSelectedRound(null);
        } else {
            setSelectedRound(roundNumber);
        }
    };

    return (
        <div className="h-full border-r border-agora-border bg-agora-surface/60 backdrop-blur-sm flex flex-col shrink-0" style={{ width: "clamp(160px, 16vw, 260px)" }}>
            <CycleNavigator />

            <div className="px-4 py-3 border-b border-agora-border">
                <h2 className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold truncate">
                    Rounds in this cycle
                </h2>
            </div>

            <div className="flex-1 p-3 space-y-1.5 overflow-y-auto">
                {rounds.map((round, idx) => {
                    const isSelected = round.roundNumber === selectedRound;
                    const isActive = round.roundNumber === execution.activeRound && selectedRound === null;
                    const isCompleted = round.status === "completed";
                    const isLocked = round.status === "locked";
                    const isWaiting = round.status === "waiting";
                    const isRunning = round.status === "running";
                    const isFailed = round.status === "failed";

                    const subtitle = isLocked
                        ? round.lockedReason ?? "Locked"
                        : isRunning
                            ? `Generating${round.generatingAgentRole ? `: ${round.generatingAgentRole}` : "..."}`
                            : isCompleted
                                ? round.roundNumber === 3
                                    ? "Synthesis ready"
                                    : `${round.completedCount}/${round.totalCount} completed`
                                : isFailed
                                    ? "Generation failed"
                                    : isWaiting
                                        ? "Waiting"
                                        : round.label;

                    return (
                        <motion.button
                            key={round.roundNumber}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            onClick={() => handleRoundClick(round.roundNumber)}
                            disabled={isLocked || isWaiting}
                            className={cn(
                                "w-full text-left p-3 rounded-xl transition-all duration-200",
                                "border",
                                isSelected
                                    ? "bg-indigo-500/15 border-indigo-400/50 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-400/30"
                                    : isRunning || isActive
                                        ? "bg-indigo-500/10 border-indigo-500/30 shadow-md shadow-indigo-500/10"
                                        : isCompleted
                                            ? "bg-agora-surface-light/50 border-emerald-500/20 hover:bg-agora-surface-light"
                                            : isFailed
                                                ? "bg-red-500/10 border-red-500/30"
                                                : isLocked
                                                    ? "bg-agora-surface-light/20 border-transparent opacity-55 cursor-not-allowed"
                                                    : "bg-agora-surface-light/30 border-transparent hover:bg-agora-surface-light/50",
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <div
                                        className={cn(
                                            "w-8 h-8 rounded-lg flex items-center justify-center text-sm",
                                            isSelected
                                                ? "bg-indigo-500/30"
                                                : isRunning || isActive
                                                    ? "bg-indigo-500/20"
                                                    : isCompleted
                                                        ? "bg-emerald-500/20"
                                                        : isFailed
                                                            ? "bg-red-500/20"
                                                            : "bg-gray-700/50",
                                        )}
                                    >
                                        {isLocked ? "🔒" : (phaseIcons[round.roundType] ?? "📌")}
                                    </div>
                                    <div
                                        className={cn(
                                            "absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-agora-surface",
                                            statusDotColors[round.status],
                                        )}
                                    />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div
                                        className={cn(
                                            "text-xs font-semibold truncate",
                                            isSelected
                                                ? "text-indigo-200"
                                                : isRunning || isActive
                                                    ? "text-indigo-300"
                                                    : isCompleted
                                                        ? "text-emerald-300"
                                                        : isFailed
                                                            ? "text-red-300"
                                                            : "text-agora-text-muted",
                                        )}
                                    >
                                        Round {round.roundNumber}
                                    </div>
                                    <div
                                        className={cn(
                                            "text-[11px] truncate",
                                            isLocked ? "text-gray-500" : "text-agora-text-muted",
                                        )}
                                        title={subtitle}
                                    >
                                        {subtitle}
                                    </div>
                                </div>
                            </div>

                            {(isSelected || isRunning || isActive) && (
                                <motion.div
                                    className={cn(
                                        "mt-2 h-0.5 rounded-full",
                                        isSelected
                                            ? "bg-gradient-to-r from-indigo-400 to-purple-400"
                                            : "bg-gradient-to-r from-indigo-500 to-purple-500",
                                    )}
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 0.6 }}
                                />
                            )}
                        </motion.button>
                    );
                })}
            </div>

        </div>
    );
}
