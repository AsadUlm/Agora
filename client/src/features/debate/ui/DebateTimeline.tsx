import { cn } from "@/shared/lib/cn";
import { motion } from "motion/react";
import { useDebateStore } from "../model/debate.store";
import { buildTimelineFromSession } from "../model/graph.mapper";
import { usePlaybackStore } from "../model/playback.store";

const phaseIcons: Record<string, string> = {
    initial: "💬",
    critique: "⚔️",
    final: "✨",
};

const statusDotColors: Record<string, string> = {
    pending: "bg-gray-600",
    active: "bg-indigo-400 animate-pulse",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
};

export default function DebateTimeline() {
    const session = useDebateStore((s) => s.session);
    const currentRound = useDebateStore((s) => s.currentRound);
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const setSelectedRound = usePlaybackStore((s) => s.setSelectedRound);

    const rounds = session
        ? buildTimelineFromSession(session)
        : [
            { roundNumber: 1, roundType: "initial" as const, status: "pending" as const, label: "Initial Proposals", agentCount: 0 },
            { roundNumber: 2, roundType: "critique" as const, status: "pending" as const, label: "Debate & Critique", agentCount: 0 },
            { roundNumber: 3, roundType: "final" as const, status: "pending" as const, label: "Synthesis", agentCount: 0 },
        ];

    const handleRoundClick = (roundNumber: number) => {
        // Toggle: if already selected, deselect (show all)
        if (selectedRound === roundNumber) {
            setSelectedRound(null);
        } else {
            setSelectedRound(roundNumber);
        }
    };

    return (
        <div className="w-64 h-full border-r border-agora-border bg-agora-surface/60 backdrop-blur-sm flex flex-col">
            <div className="px-4 py-4 border-b border-agora-border">
                <h2 className="text-xs uppercase tracking-widest text-agora-text-muted font-semibold">
                    Debate Timeline
                </h2>
            </div>

            <div className="flex-1 p-4 space-y-2 overflow-y-auto">
                {rounds.map((round, idx) => {
                    const isSelected = round.roundNumber === selectedRound;
                    const isActive = round.roundNumber === currentRound && selectedRound === null;
                    const isCompleted = round.status === "completed";
                    const isPending = round.status === "pending";

                    return (
                        <motion.button
                            key={round.roundNumber}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            onClick={() => handleRoundClick(round.roundNumber)}
                            className={cn(
                                "w-full text-left p-3 rounded-xl transition-all duration-200",
                                "border",
                                isSelected
                                    ? "bg-indigo-500/15 border-indigo-400/50 shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-400/30"
                                    : isActive
                                        ? "bg-indigo-500/10 border-indigo-500/30 shadow-md shadow-indigo-500/10"
                                        : isCompleted
                                            ? "bg-agora-surface-light/50 border-emerald-500/20 hover:bg-agora-surface-light"
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
                                                : isActive
                                                    ? "bg-indigo-500/20"
                                                    : isCompleted
                                                        ? "bg-emerald-500/20"
                                                        : "bg-gray-700/50",
                                        )}
                                    >
                                        {phaseIcons[round.roundType] ?? "📌"}
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
                                            "text-xs font-semibold",
                                            isSelected
                                                ? "text-indigo-200"
                                                : isActive
                                                    ? "text-indigo-300"
                                                    : isCompleted
                                                        ? "text-emerald-300"
                                                        : "text-agora-text-muted",
                                        )}
                                    >
                                        Round {round.roundNumber}
                                    </div>
                                    <div
                                        className={cn(
                                            "text-[11px] truncate",
                                            isPending ? "text-gray-500" : "text-agora-text-muted",
                                        )}
                                    >
                                        {round.label}
                                    </div>
                                </div>
                            </div>

                            {(isSelected || isActive) && (
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

            {/* Legend */}
            <div className="p-4 border-t border-agora-border space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-2">
                    Edge Legend
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-pink-400" style={{ backgroundImage: "repeating-linear-gradient(90deg, #f472b6, #f472b6 4px, transparent 4px, transparent 7px)" }} />
                    <span className="text-[10px] text-agora-text-muted">Challenge</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-emerald-400" />
                    <span className="text-[10px] text-agora-text-muted">Support</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-indigo-400" style={{ backgroundImage: "repeating-linear-gradient(90deg, #818cf8, #818cf8 3px, transparent 3px, transparent 6px)" }} />
                    <span className="text-[10px] text-agora-text-muted">Inquiry</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-0.5 bg-violet-400" />
                    <span className="text-[10px] text-agora-text-muted">Summarizes</span>
                </div>
            </div>
        </div>
    );
}
