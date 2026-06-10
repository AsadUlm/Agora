/**
 * DebateOverviewPanel — default right-sidebar tab after a debate completes.
 *
 * Running mode:  Live 3-phase progress tracker + status card.
 * Completed mode: Debate Process Summary (3-phase) → Exchange Highlights → Final Answer → Nav links.
 *
 * Design principles:
 *  - The 3-phase conceptual model (Opening / Debate Exchange / Final Decision) is shown first.
 *  - Exchange Highlights table answers "where can I see the actual debate?"
 *  - Summaries first, raw content hidden by default (expandable)
 *  - Clear incomplete-trace warnings when stages are missing
 */
import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { useDebateStore } from "../model/debate.store";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import { useDebateViewState } from "../model/useDebateViewState";
import { extractFullResponse, formatFinalSummary } from "../model/formatters";
import type { AgentDTO, CritiqueTraceItem, CritiqueResponseTraceItem, DebateTrace, RevisedPositionTraceItem, TurnDTO } from "../api/debate.types";
import DebateStoryBlock from "./DebateStoryBlock";
import DebateTimeline from "./DebateTimeline";
import InlineActionButton from "./primitives/InlineActionButton";
import SectionCard from "./primitives/SectionCard";
import AgentBadge from "./primitives/AgentBadge";
import { usePlaybackStore } from "../model/playback.store";
import { getSelectedCycle } from "../model/debate-cycle.selectors";
import { buildDebateProcessModel } from "../model/debate-process.selectors";
import Round3SynthesisVerdict from "./Round3SynthesisVerdict";
import { useSelectedCycleState } from "../model/useSelectedCycleState";

interface DebateOverviewPanelProps {
    onNavigate?: (tab: "debate_process" | "followup" | "debug") => void;
}

export default function DebateOverviewPanel({ onNavigate }: DebateOverviewPanelProps) {
    const session = useDebateStore((s) => s.session);
    const execution = useDebateExecutionState();
    const view = useDebateViewState();
    const turn = session?.latest_turn ?? null;
    const selectedCycle = usePlaybackStore((s) => s.selectedCycle);
    const { cycle, state: cycleState } = useSelectedCycleState();
    const process = buildDebateProcessModel(session, selectedCycle);

    const isRunning = cycleState.status === "running";
    const isCompleted = cycleState.status === "completed";
    const isFailed = cycleState.status === "failed";
    const isPartial = cycleState.status === "partially_completed";
    const isQueued = cycleState.status === "queued";

    if ((isQueued && cycle.cycleType === "original") || (!turn && !isRunning)) {
        return (
            <div className="flex items-center justify-center h-32 text-white/30 text-sm">
                No debate in progress.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* ── Debate Timeline (Progress) ── */}
            <SectionCard>
                <DebateTimeline />
            </SectionCard>

            {/* ── Running state ── */}
            {isRunning && (
                cycle.cycleType === "original"
                    ? <RunningOverview execution={execution} />
                    : (
                        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-3">
                            <p className="text-[12px] font-semibold text-indigo-200">
                                {cycle.title} is running
                            </p>
                            <p className="mt-1 text-[11px] text-indigo-300/75">
                                Active: {cycleState.activeStageLabel ?? "preparing follow-up cycle"}
                            </p>
                        </div>
                    )
            )}

            {/* ── Failure state ── */}
            {(isFailed || isPartial) && (
                <div className={cn("rounded-lg border px-3 py-3", isPartial ? "border-amber-500/40 bg-amber-500/10" : "border-red-500/40 bg-red-500/10")}>
                    <p className={cn("text-[12px] font-semibold mb-1", isPartial ? "text-amber-300" : "text-red-300")}>
                        {isPartial ? `${cycle.title} partially completed` : `${cycle.title} failed`}
                    </p>
                    <p className={cn("text-[11px]", isPartial ? "text-amber-200/70" : "text-red-200/70")}>
                        {isPartial && !cycleState.hasUpdatedSynthesis
                            ? "Updated synthesis was not generated. Available follow-up results remain visible."
                            : view.banner.message || "This cycle ended without usable results."}
                    </p>
                </div>
            )}

            {/* ── Completed state ── */}
            {cycle.cycleType === "followup" && (
                <FollowUpCycleOverview cycle={cycle} cycleState={cycleState} process={process} />
            )}

            {(isCompleted || isPartial) && turn && cycle.cycleType === "original" && (
                <CompletedOverview turn={turn} onNavigate={onNavigate} />
            )}
        </div>
    );
}

function FollowUpCycleOverview({
    cycle,
    cycleState,
    process,
}: {
    cycle: ReturnType<typeof getSelectedCycle>;
    cycleState: ReturnType<typeof useSelectedCycleState>["state"];
    process: ReturnType<typeof buildDebateProcessModel>;
}) {
    const agents = useDebateStore((s) => s.session?.agents ?? []);
    const hasData = cycle.rounds.length > 0;

    return (
        <div className="space-y-4">
            <SectionCard>
                <p className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">Follow-up Question</p>
                <p className="mt-2 text-sm text-white/85 leading-relaxed">
                    {cycle.question || "Follow-up question is not available in the loaded snapshot."}
                </p>
            </SectionCard>

            {!hasData && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">
                    This follow-up cycle is still generating or has not been fully loaded.
                </div>
            )}

            {hasData && !process.round3.moderatorVerdict && (
                <div className={cn(
                    "rounded-xl border p-3 text-xs",
                    cycleState.status === "running"
                        ? "border-indigo-500/25 bg-indigo-500/5 text-indigo-100"
                        : "border-amber-500/25 bg-amber-500/5 text-amber-100",
                )}>
                    {cycleState.status === "running"
                        ? "Follow-up responses are available. Updated synthesis is still being generated."
                        : "Updated synthesis was not generated. Available follow-up responses are shown above."}
                </div>
            )}

            <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 font-semibold mb-2">Updated Verdict</p>
                <Round3SynthesisVerdict process={process} />
            </div>

            <CompactAgentsSummary agents={agents} />
        </div>
    );
}

// ── Running overview ──────────────────────────────────────────────────────────

function RunningOverview({ execution }: { execution: ReturnType<typeof useDebateExecutionState> }) {
    const { stages, currentAgentRole } = execution;

    const activeStageObj = stages?.find((s) => s.status === "running") ?? null;
    const liveMessages = activeStageObj?.activityMessages ?? [];

    // Map stage index to phase name
    const phaseForStage = (idx: number) =>
        idx === 1 ? "Phase 1: Opening Positions"
        : idx <= 4 ? "Phase 2: Debate Exchange"
        : "Phase 3: Final Decision";

    return (
        <div className="space-y-3">
            {/* Status card */}
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    <span className="text-[12px] font-semibold text-indigo-200">
                        {activeStageObj
                            ? phaseForStage(activeStageObj.index)
                            : "Debate Running"}
                    </span>
                </div>
                {activeStageObj && (
                    <p className="text-[11px] text-indigo-300/70 pl-4">
                        Stage {activeStageObj.index}: {activeStageObj.shortLabel}
                    </p>
                )}
                {currentAgentRole && (
                    <p className="text-[11px] text-indigo-300/80 pl-4 mt-0.5">
                        {currentAgentRole} is generating…
                    </p>
                )}
                {liveMessages.length > 0 && (
                    <div className="mt-2 pl-4 space-y-0.5">
                        {liveMessages.map((msg, i) => (
                            <p key={i} className="text-[10px] text-white/40">✓ {msg}</p>
                        ))}
                    </div>
                )}
            </div>

        </div>
    );
}

function CompactAgentsSummary({ agents }: { agents: AgentDTO[] }) {
    if (!agents || agents.length === 0) return null;
    return (
        <div className="rounded-xl border border-white/10 bg-white/3 px-3 py-3 space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm">👥</span>
                    <h3 className="text-[12px] font-semibold text-white/80">Debating Agents</h3>
                </div>
                <span className="text-[10px] text-white/40">{agents.length} agents</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
                {agents.map((agent) => {
                    const role = agent.role ? agent.role.charAt(0).toUpperCase() + agent.role.slice(1) : "Agent";
                    const slash = agent.model?.indexOf("/") ?? -1;
                    const model = slash >= 0 ? agent.model.slice(slash + 1) : agent.model || "Not specified";
                    return (
                        <div key={agent.id} className="flex items-center justify-between px-2 py-1 rounded bg-white/5 border border-white/5">
                            <AgentBadge>{role}</AgentBadge>
                            <span className="text-[10px] text-white/40 font-mono">{model}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Completed overview ────────────────────────────────────────────────────────

function CompletedOverview({
    turn,
    onNavigate,
}: {
    turn: TurnDTO;
    onNavigate?: DebateOverviewPanelProps["onNavigate"];
}) {
    const agents = useDebateStore((s) => s.session?.agents ?? []);
    const [summaryExpanded, setSummaryExpanded] = useState(false);
    const finalSummaryText = stringifyFinalSummary(turn.final_summary);
    const trace = turn.debate_trace;

    return (
        <div className="space-y-4">
            {/* ── Debating Agents Summary (compact) ── */}
            <CompactAgentsSummary agents={agents} />

            {/* ── Debate Exchange Highlights ── */}
            {trace && <ExchangeHighlights trace={trace} onNavigate={onNavigate} />}

            {/* ── Debate Story (narrative) ── */}
            {trace && <DebateStoryBlock turn={turn} />}

            {/* ── Final Answer ── */}
            {finalSummaryText && (
                <FinalAnswerCard
                    summary={finalSummaryText}
                    expanded={summaryExpanded}
                    onToggle={() => setSummaryExpanded((v) => !v)}
                />
            )}

            {/* ── Navigation links ── */}
            <NavLinks onNavigate={onNavigate} />
        </div>
    );
}

function stringifyFinalSummary(summary: TurnDTO["final_summary"]): string {
    if (!summary) return "";
    const raw = JSON.stringify(summary);
    const fullResponse = extractFullResponse(raw);
    return fullResponse || formatFinalSummary(raw);
}


// ── Debate Exchange Highlights ────────────────────────────────────────────────

function ExchangeHighlights({
    trace,
    onNavigate,
}: {
    trace: DebateTrace;
    onNavigate?: DebateOverviewPanelProps["onNavigate"];
}) {
    const [open, setOpen] = useState(true);

    const critiques = trace.critiques ?? [];
    const responses = trace.critique_responses ?? [];
    const revisions = trace.revised_positions ?? [];

    if (critiques.length === 0) {
        return null;
    }

    // Build exchange rows: one per critique
    const rows = critiques.map((c: CritiqueTraceItem) => {
        const response: CritiqueResponseTraceItem | undefined = responses.find(
            (r) => r.agent_id === c.to_agent_id || r.agent_name === c.to_agent_name,
        );
        const revision: RevisedPositionTraceItem | undefined = revisions.find(
            (r) => r.agent_id === c.to_agent_id || r.agent_name === c.to_agent_name,
        );
        const changed = revision?.changed ?? null;
        const changeLabel =
            changed === true
                ? revision?.change_type?.replace(/_/g, " ") || "Changed"
                : changed === false
                    ? "Unchanged"
                    : "—";
        const changeColor =
            changed === true ? "text-amber-300"
                : changed === false ? "text-emerald-400"
                : "text-white/30";

        return { critique: c, response, revision, changeLabel, changeColor };
    });

    return (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-2 mb-2"
            >
                <span className="text-sm">⚔️</span>
                <h3 className="text-[12px] font-semibold text-rose-200 flex-1 text-left">
                    Debate Exchange Highlights
                </h3>
                <span className="text-[10px] text-white/30">{open ? "▲" : "▼"}</span>
            </button>
            <p className="text-[10px] text-white/40 mb-2 leading-relaxed">
                Who challenged whom, what was critiqued, and how positions changed.
            </p>

            {open && (
                <div className="space-y-2">
                    {rows.map(({ critique, response, changeLabel, changeColor }, i) => (
                        <div key={i} className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 space-y-1.5">
                            {/* Critic → Target */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-200 border border-rose-500/30">
                                    {critique.from_agent_name}
                                </span>
                                <span className="text-[10px] text-white/40">challenged</span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-200 border border-indigo-500/30">
                                    {critique.to_agent_name}
                                </span>
                            </div>

                            {/* Challenged claim */}
                            {critique.target_claim && (
                                <p className="text-[10px] text-amber-200/70 italic leading-snug line-clamp-2">
                                    Claim: "{critique.target_claim}"
                                </p>
                            )}

                            {/* Critique summary */}
                            {critique.critique_summary && (
                                <p className="text-[10px] text-white/60 leading-snug line-clamp-2">
                                    Critique: {critique.critique_summary}
                                </p>
                            )}

                            {/* Response summary */}
                            {response?.response && (
                                <p className="text-[10px] text-sky-300/70 leading-snug line-clamp-2">
                                    Response: {response.response}
                                </p>
                            )}

                            {/* Position changed */}
                            <div className="flex items-center gap-1.5 pt-0.5">
                                <span className="text-[10px] text-white/30">Position changed:</span>
                                <span className={cn("text-[10px] font-medium", changeColor)}>
                                    {changeLabel}
                                </span>
                            </div>
                        </div>
                    ))}

                    {onNavigate && (
                        <InlineActionButton
                            onClick={() => onNavigate("debate_process")}
                            className="text-rose-300 hover:text-rose-100"
                        >
                            See full argument chains in Debate Process →
                        </InlineActionButton>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Final Answer card ─────────────────────────────────────────────────────────

function FinalAnswerCard({
    summary,
    expanded,
    onToggle,
}: {
    summary: string;
    expanded: boolean;
    onToggle: () => void;
}) {
    const PREVIEW_CHARS = 280;
    const isLong = summary.length > PREVIEW_CHARS;
    const displayText = expanded || !isLong ? summary : summary.slice(0, PREVIEW_CHARS) + "…";

    return (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-3">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🏆</span>
                <h3 className="text-[12px] font-semibold text-violet-200">Moderator Verdict</h3>
            </div>
            <p className="text-[12px] text-white/75 leading-relaxed whitespace-pre-wrap">{displayText}</p>
            {isLong && (
                <InlineActionButton
                    onClick={onToggle}
                    className="mt-1"
                >
                    {expanded ? "▲ Show less" : "▼ Read full answer"}
                </InlineActionButton>
            )}
        </div>
    );
}

// ── Navigation links ──────────────────────────────────────────────────────────

function NavLinks({
    onNavigate,
}: {
    onNavigate?: DebateOverviewPanelProps["onNavigate"];
}) {
    const links: Array<{ icon: string; label: string; tab: "debate_process" | "followup" | "debug"; desc: string }> = [
        { icon: "⚔️",  label: "Debate Process",    tab: "debate_process", desc: "Argument chains · position evolution" },
        { icon: "{ }", label: "Debug / Raw Output", tab: "debug",          desc: "Full LLM outputs · lifecycle data" },
    ];

    if (!onNavigate) return null;

    return (
        <div>
            <p className="text-[10px] text-white/30 uppercase tracking-wide font-medium mb-2">Explore Further</p>
            <div className="space-y-1.5">
                {links.map((link) => (
                    <button
                        key={link.tab}
                        type="button"
                        onClick={() => onNavigate(link.tab)}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors text-left group"
                    >
                        <span className="text-sm opacity-70 group-hover:opacity-100 transition-opacity">{link.icon}</span>
                        <div className="min-w-0">
                            <p className="text-[11px] font-medium text-white/75 group-hover:text-white transition-colors">{link.label}</p>
                            <p className="text-[10px] text-white/35">{link.desc}</p>
                        </div>
                        <span className="ml-auto text-white/25 text-xs group-hover:text-white/50 transition-colors">→</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
