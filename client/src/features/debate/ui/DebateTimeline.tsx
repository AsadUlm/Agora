import { cn } from "@/shared/lib/cn";
import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { usePlaybackStore } from "../model/playback.store";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import CycleNavigator from "./CycleNavigator";
import type { RoundExecutionState } from "../model/execution-state";
import StatusBadge from "./primitives/StatusBadge";
import { useSelectedCycleState } from "../model/useSelectedCycleState";

// ── Phase definitions ─────────────────────────────────────────────────────────

interface PhaseDefinition {
    id: string;
    label: string;
    description: string;
    icon: string;
    stageIndices: number[]; // 1-based stage indices in this phase
}

const PHASES: PhaseDefinition[] = [
    {
        id: "opening",
        label: "Opening Positions",
        description: "Agents independently present starting positions.",
        icon: "💬",
        stageIndices: [1],
    },
    {
        id: "exchange",
        label: "Debate Exchange",
        description: "Agents challenge each other, respond, and revise.",
        icon: "⚔️",
        stageIndices: [2, 3, 4],
    },
    {
        id: "decision",
        label: "Final Decision",
        description: "Moderator synthesizes the strongest arguments.",
        icon: "✨",
        stageIndices: [5],
    },
];

// ── Status colors ─────────────────────────────────────────────────────────────

const statusDotColors: Record<string, string> = {
    locked: "bg-gray-700",
    waiting: "bg-gray-500",
    running: "bg-indigo-400 animate-pulse",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
    partially_completed: "bg-amber-500",
    skipped: "bg-gray-600",
};

type PhaseStatus = "locked" | "waiting" | "running" | "partially_completed" | "completed" | "failed";

function derivePhaseStatus(rounds: RoundExecutionState[], stageIndices: number[]): PhaseStatus {
    const phaseRounds = rounds.filter((r) => stageIndices.includes(r.roundNumber));
    if (phaseRounds.length === 0) return "locked";
    if (phaseRounds.some((r) => r.status === "failed")) return "failed";
    if (phaseRounds.some((r) => r.status === "running")) return "running";
    if (phaseRounds.every((r) => r.status === "completed")) return "completed";
    if (phaseRounds.some((r) => r.status === "completed" || r.status === "partially_completed")) return "partially_completed";
    if (phaseRounds.some((r) => r.status === "waiting")) return "waiting";
    return "locked";
}

const phaseStatusStyles: Record<PhaseStatus, { border: string; bg: string; label: string; dot: string }> = {
    locked:             { border: "border-transparent",       bg: "bg-agora-surface-light/20", label: "text-white/25",   dot: "bg-gray-700" },
    waiting:            { border: "border-white/15",          bg: "bg-white/5",                label: "text-white/50",   dot: "bg-gray-500" },
    running:            { border: "border-indigo-500/40",     bg: "bg-indigo-500/10",          label: "text-indigo-200", dot: "bg-indigo-400 animate-pulse" },
    partially_completed:{ border: "border-amber-500/30",      bg: "bg-amber-500/8",            label: "text-amber-200",  dot: "bg-amber-500" },
    completed:          { border: "border-emerald-500/25",    bg: "bg-emerald-500/8",          label: "text-emerald-200",dot: "bg-emerald-500" },
    failed:             { border: "border-red-500/30",        bg: "bg-red-500/10",             label: "text-red-300",    dot: "bg-red-500" },
};

// ── Single stage row ──────────────────────────────────────────────────────────

function StageRow({
    round,
    isSelected,
    isActive,
    onClick,
    isLast,
}: {
    round: RoundExecutionState;
    isSelected: boolean;
    isActive: boolean;
    onClick: () => void;
    isLast: boolean;
}) {
    const isLocked = round.status === "locked";
    const isWaiting = round.status === "waiting";
    const isRunning = round.status === "running";
    const isCompleted = round.status === "completed";
    const isFailed = round.status === "failed";
    const isPartial = round.status === "partially_completed";

    const subtitle = isLocked
        ? "Waiting for previous stage"
        : isRunning
            ? `Generating${round.generatingAgentRole ? `: ${round.generatingAgentRole}` : "…"}`
            : isCompleted
                ? `${round.completedCount}/${round.totalCount} completed`
                : isPartial
                    ? `${round.completedCount}/${round.totalCount} available`
                    : isFailed
                        ? "Generation failed"
                        : isWaiting
                            ? "Waiting"
                            : round.label;

    const clickable = round.status === "running" || round.status === "completed" || round.status === "failed";

    return (
        <div className="flex gap-2 px-3">
            {/* Connector */}
            <div className="flex flex-col items-center shrink-0" style={{ width: 16 }}>
                <div className="w-px flex-1 bg-white/10" />
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDotColors[round.status])} />
                {!isLast && <div className="w-px flex-1 bg-white/10" />}
            </div>

            {/* Content */}
            <button
                onClick={onClick}
                disabled={!clickable}
                className={cn(
                    "flex-1 min-h-12 text-left px-3 py-2 mb-1 rounded-lg border transition-all duration-150 text-xs",
                    isSelected
                        ? "bg-indigo-500/15 border-indigo-400/50 ring-1 ring-indigo-400/25"
                        : isRunning || isActive
                            ? "bg-indigo-500/10 border-indigo-500/25"
                            : isCompleted
                                ? "bg-white/5 border-white/10 hover:bg-white/10 cursor-pointer"
                                : isFailed
                                    ? "bg-red-500/8 border-red-500/25"
                                    : "bg-transparent border-transparent opacity-50 cursor-not-allowed",
                )}
            >
                <p className={cn(
                    "font-semibold truncate leading-snug",
                    isSelected ? "text-indigo-200"
                        : isRunning || isActive ? "text-indigo-300"
                        : isCompleted ? "text-white/75"
                        : isFailed ? "text-red-300"
                        : "text-white/25",
                )}>
                    Stage {round.roundNumber}
                    <span className="font-normal opacity-70 ml-1">{round.shortLabel}</span>
                </p>
                <p className={cn(
                    "text-[10px] truncate mt-0.5 leading-tight",
                    isLocked ? "text-white/20" : "text-white/40",
                )}
                    title={subtitle}
                >
                    {subtitle}
                </p>
                {(isSelected || isRunning || isActive) && (
                    <motion.div
                        className={cn(
                            "mt-1 h-0.5 rounded-full",
                            isSelected ? "bg-gradient-to-r from-indigo-400 to-purple-400" : "bg-gradient-to-r from-indigo-500 to-purple-500",
                        )}
                        initial={{ width: "0%" }}
                        animate={{ width: "100%" }}
                        transition={{ duration: 0.5 }}
                    />
                )}
            </button>
        </div>
    );
}

// ── Phase card ────────────────────────────────────────────────────────────────

function PhaseCard({
    phase,
    rounds,
    selectedRound,
    activeRound,
    onRoundClick,
    index,
}: {
    phase: PhaseDefinition;
    rounds: RoundExecutionState[];
    selectedRound: number | null;
    activeRound: number;
    onRoundClick: (n: number) => void;
    index: number;
}) {
    const phaseRounds = rounds.filter((r) => phase.stageIndices.includes(r.roundNumber));
    const status = derivePhaseStatus(rounds, phase.stageIndices);
    const styles = phaseStatusStyles[status];
    const completedCount = phaseRounds.filter(
        (r) => r.status === "completed" || r.status === "partially_completed" || r.status === "skipped",
    ).length;
    const totalCount = phase.stageIndices.length;
    const activeStage = phaseRounds.find((r) => r.status === "running" || r.roundNumber === activeRound);
    const [expanded, setExpanded] = useState(true);

    const isLocked = status === "locked";
    const isCompleted = status === "completed";
    const isExpanded = expanded || status === "running" || status === "partially_completed";

    return (
        <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.08 }}
            className={cn("rounded-xl border overflow-hidden shadow-sm shadow-black/10", styles.border, styles.bg)}
        >
            {/* Phase header */}
            <button
                className={cn(
                    "w-full min-h-16 text-left p-3.5 flex items-center gap-2.5 transition-colors",
                    isLocked ? "opacity-50 cursor-default" : "hover:bg-white/5",
                )}
                onClick={() => !isLocked && setExpanded((v) => !v)}
                disabled={isLocked}
            >
                {/* Icon + dot */}
                <div className="relative shrink-0">
                    <span className={cn("text-base", isLocked ? "grayscale opacity-40" : "")}>{phase.icon}</span>
                    <div className={cn("absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-agora-surface", styles.dot)} />
                </div>

                {/* Labels */}
                <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-semibold truncate", styles.label)}>
                        {phase.label}
                    </p>
                    {status === "running" && activeStage ? (
                        <p className="text-[10px] text-indigo-300/70 truncate mt-0.5">
                            Now: {activeStage.shortLabel}
                        </p>
                    ) : (
                        <p className="text-[10px] text-white/55 truncate mt-0.5">
                            {phase.description}
                        </p>
                    )}
                </div>

                {/* Right side */}
                <div className="flex items-center gap-2 shrink-0">
                    {(isCompleted || completedCount > 0) && (
                        <span className={cn(
                            "h-5 min-w-9 inline-flex items-center justify-center text-[9px] font-semibold px-1.5 rounded-full border",
                            isCompleted
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                : "bg-white/10 text-white/40 border-white/15",
                        )}>
                            {completedCount}/{totalCount}
                        </span>
                    )}
                    {!isLocked && (
                        <span className="w-4 text-center text-[10px] text-white/45">{isExpanded ? "▲" : "▼"}</span>
                    )}
                </div>
            </button>

            {/* Stage rows */}
            {isExpanded && !isLocked && phaseRounds.length > 0 && (
                <div className="pb-2">
                    {phaseRounds.map((round, i) => (
                        <StageRow
                            key={round.roundNumber}
                            round={round}
                            isSelected={round.roundNumber === selectedRound}
                            isActive={round.roundNumber === activeRound && selectedRound === null}
                            onClick={() => onRoundClick(round.roundNumber)}
                            isLast={i === phaseRounds.length - 1}
                        />
                    ))}
                </div>
            )}
        </motion.div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DebateTimeline({ mobile = false }: { mobile?: boolean }) {
    const { cycle, state: cycleState } = useSelectedCycleState();
    const execution = useDebateExecutionState();
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const setSelectedRound = usePlaybackStore((s) => s.setSelectedRound);

    const rounds = execution.rounds;

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
        if (selectedRound === roundNumber) {
            setSelectedRound(null);
        } else {
            setSelectedRound(roundNumber);
        }
    };

    if (cycle.cycleType === "followup") {
        const steps = [
            { label: "Follow-up Responses", messages: cycle.stages.initialAnswers, roundTypes: ["followup_response"] },
            { label: "Follow-up Cross-Critiques", messages: cycle.stages.crossCritiques, roundTypes: ["followup_cross_critique", "followup_critique"] },
            { label: "Responses to Follow-up Critiques", messages: cycle.stages.responsesToCritiques, roundTypes: ["followup_response_to_critique"] },
            { label: "Revised Follow-up Positions", messages: cycle.stages.revisedPositions, roundTypes: ["followup_revised_position"] },
            { label: "Updated Synthesis", messages: cycle.stages.finalSynthesis, roundTypes: ["updated_synthesis"] },
        ];
        return (
            <div className={cn("flex flex-col shrink-0", mobile ? "w-full" : "")}>
                <CycleNavigator />
                <div className="px-1 py-2.5 border-b border-white/5 mb-2">
                    <h2 className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">Follow-up Progress</h2>
                    <p className="text-[10px] text-white/55 mt-0.5">5 follow-up stages</p>
                </div>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const round = cycle.rounds.find((item) => step.roundTypes.some(type => item.round_type === type));
                        let statusText = "pending";
                        let tone: "success" | "danger" | "accent" | "neutral" = "neutral";

                        if (round) {
                            statusText = round.status?.replace("_", " ") ?? "pending";
                            tone = round.status === "completed" ? "success" : round.status === "failed" ? "danger" : round.status === "running" ? "accent" : "neutral";
                        } else {
                            const isCycleTerminal = ["completed", "partially_completed", "failed"].includes(cycleState.status);
                            if (isCycleTerminal) {
                                statusText = "not generated";
                                tone = "neutral";
                            } else {
                                statusText = "pending";
                                tone = "neutral";
                            }
                        }

                        return (
                            <div key={step.label} className="min-h-14 rounded-xl border border-white/10 bg-white/[0.035] p-3 flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-violet-500/15 text-violet-200 inline-flex items-center justify-center text-[10px] font-bold">{index + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-white/80">{step.label}</p>
                                    <p className="text-[10px] text-white/55 mt-0.5">{step.messages.length} message{step.messages.length === 1 ? "" : "s"} available</p>
                                </div>
                                <StatusBadge tone={tone}>{statusText}</StatusBadge>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col shrink-0", mobile ? "w-full" : "")}>
            <CycleNavigator />

            <div className="px-1 py-2.5 border-b border-white/5 mb-2">
                <h2 className="text-[10px] uppercase tracking-widest text-white/50 font-semibold">
                    Debate Progress
                </h2>
                <p className="text-[10px] text-white/55 mt-0.5">3 phases · 5 internal stages</p>
            </div>

            <div className="space-y-2">
                {PHASES.map((phase, idx) => (
                    <PhaseCard
                        key={phase.id}
                        phase={phase}
                        rounds={rounds}
                        selectedRound={selectedRound}
                        activeRound={execution.activeRound}
                        onRoundClick={handleRoundClick}
                        index={idx}
                    />
                ))}
            </div>
        </div>
    );
}
