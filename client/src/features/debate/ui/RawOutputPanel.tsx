/**
 * RawOutputPanel — Improved UX.
 *
 * Groups follow-up rounds by cycle number so each follow-up cycle
 * (FOLLOWUP_RESPONSE / FOLLOWUP_CRITIQUE / UPDATED_SYNTHESIS) appears as
 * one collapsible parent block with per-round and per-cycle copy buttons.
 */
import { useMemo, useState } from "react";
import { useDebateStore } from "../model/debate.store";
import type { RoundDTO } from "../api/debate.types";
import { cn } from "@/shared/lib/cn";
import { useDebateViewState } from "../model/useDebateViewState";
import { buildDebateProcessModel } from "../model/debate-process.selectors";
import { usePlaybackStore } from "../model/playback.store";
import { useSelectedCycleState } from "../model/useSelectedCycleState";

// ── Constants ──────────────────────────────────────────────────────────────

const FOLLOWUP_TYPES = new Set([
    "followup_response",
    "followup_critique",
    "followup_cross_critique",
    "followup_response_to_critique",
    "followup_revised_position",
    "updated_synthesis",
]);

// ── Grouping types ─────────────────────────────────────────────────────────

type RawGroup =
    | { kind: "base_round"; round: RoundDTO }
    | { kind: "followup_cycle"; cycle: number | string; rounds: RoundDTO[] };

// ── Grouping logic ─────────────────────────────────────────────────────────

function groupRounds(rounds: RoundDTO[]): RawGroup[] {
    const groups: RawGroup[] = [];
    const followupMap = new Map<string, RoundDTO[]>();

    for (const round of rounds) {
        const rt = (round.round_type ?? "").toLowerCase();
        const isFollowup =
            round.cycle_number != null || FOLLOWUP_TYPES.has(rt);

        if (!isFollowup) {
            groups.push({ kind: "base_round", round });
            continue;
        }

        const cycleKey = String(round.cycle_number ?? "unknown");
        if (!followupMap.has(cycleKey)) {
            const arr: RoundDTO[] = [];
            followupMap.set(cycleKey, arr);
            groups.push({ kind: "followup_cycle", cycle: cycleKey, rounds: arr });
        }
        followupMap.get(cycleKey)!.push(round);
    }

    return groups;
}

// ── Clipboard helper ───────────────────────────────────────────────────────

async function copyToClipboard(value: unknown): Promise<boolean> {
    const text =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        return success;
    } catch (err) {
        console.error("Failed to copy JSON:", err);
        return false;
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRoundType(rt: string | undefined): string {
    if (!rt) return "unknown";
    return rt.replace(/_/g, " ").toUpperCase();
}

// ── ParseStatusBadge ───────────────────────────────────────────────────────

type ParseStatus = "parsed" | "recovered" | "partial" | "fallback";

function deriveParseStatus(payload: Record<string, unknown> | undefined | null): {
    status: ParseStatus;
    warnings: string[];
} {
    if (!payload || typeof payload !== "object") {
        return { status: "parsed", warnings: [] };
    }
    const rawStatus = (payload as Record<string, unknown>)["parse_status"];
    const rawWarnings = (payload as Record<string, unknown>)["parse_warnings"];
    const isFallback = (payload as Record<string, unknown>)["is_fallback"];
    const warnings = Array.isArray(rawWarnings)
        ? rawWarnings.filter((w): w is string => typeof w === "string")
        : [];

    if (
        rawStatus === "parsed" ||
        rawStatus === "recovered" ||
        rawStatus === "partial" ||
        rawStatus === "fallback"
    ) {
        return { status: rawStatus, warnings };
    }
    // Backward-compat: derive from is_fallback if parse_status missing.
    return { status: isFallback === true ? "fallback" : "parsed", warnings };
}

const STATUS_BADGE_CLASS: Record<ParseStatus, string> = {
    parsed:
        "border-slate-500/30 bg-slate-500/10 text-slate-300",
    recovered:
        "border-blue-500/40 bg-blue-500/10 text-blue-300",
    partial:
        "border-amber-500/40 bg-amber-500/10 text-amber-300",
    fallback:
        "border-red-500/40 bg-red-500/10 text-red-300",
};

const STATUS_LABEL: Record<ParseStatus, string> = {
    parsed: "parsed",
    recovered: "recovered",
    partial: "partial",
    fallback: "fallback",
};

function ParseStatusBadge({
    status,
    warnings,
}: {
    status: ParseStatus;
    warnings: string[];
}) {
    const title = warnings.length > 0 ? warnings.join("\n") : undefined;
    return (
        <span
            title={title}
            className={cn(
                "shrink-0 px-1.5 py-[1px] rounded text-[9px] font-medium uppercase tracking-wide border",
                STATUS_BADGE_CLASS[status],
            )}
        >
            {STATUS_LABEL[status]}
            {warnings.length > 0 ? ` · ${warnings.length}` : ""}
        </span>
    );
}

// ── CopyButton ─────────────────────────────────────────────────────────────

function CopyButton({
    onCopy,
    label = "Copy JSON",
}: {
    onCopy: () => Promise<boolean>;
    label?: string;
}) {
    const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const ok = await onCopy();
        setStatus(ok ? "copied" : "failed");
        setTimeout(() => setStatus("idle"), 2000);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={cn(
                "shrink-0 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors",
                status === "idle" &&
                "border-agora-border text-agora-text-muted hover:bg-agora-surface-light/50 hover:text-white",
                status === "copied" &&
                "border-green-500/40 text-green-400 bg-green-500/10",
                status === "failed" &&
                "border-red-500/40 text-red-400 bg-red-500/10",
            )}
        >
            {status === "idle"
                ? label
                : status === "copied"
                    ? "Copied ✓"
                    : "Copy failed"}
        </button>
    );
}

// ── RawPayloadView ─────────────────────────────────────────────────────────

function RawPayloadView({ data }: { data: unknown }) {
    return (
        <pre className="max-h-[520px] overflow-auto rounded-lg border border-agora-border bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-300 font-mono whitespace-pre-wrap break-words">
            {JSON.stringify(data, null, 2)}
        </pre>
    );
}

// ── RawRoundCard ───────────────────────────────────────────────────────────

function RawRoundCard({
    round,
    nested = false,
}: {
    round: RoundDTO;
    nested?: boolean;
}) {
    const [open, setOpen] = useState(false);

    const roundPayload = {
        round_number: round.round_number,
        round_type: round.round_type,
        cycle_number: round.cycle_number,
        messages: round.messages.map((m) => ({
            agent_role: m.agent_role,
            message_type: m.message_type,
            sequence_no: m.sequence_no,
            payload: m.payload,
        })),
    };

    return (
        <div
            className={cn(
                "rounded-md border",
                nested
                    ? "border-agora-border/60 bg-agora-surface/30"
                    : "border-agora-border bg-agora-surface-light/30",
            )}
        >
            <div className="px-3 py-2 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                >
                    <span
                        className={cn(
                            "text-[10px] text-agora-text-muted transition-transform shrink-0",
                            open && "rotate-90",
                        )}
                    >
                        ▶
                    </span>
                    <span className="text-[11px] font-semibold text-white">
                        Stage {round.round_number}
                    </span>
                    <span className="text-[10px] text-agora-text-muted uppercase tracking-wide truncate">
                        {formatRoundType(round.round_type)}
                    </span>
                </button>

                <CopyButton onCopy={() => copyToClipboard(roundPayload)} />
            </div>

            {open && (
                <div className="px-3 pb-3 space-y-2">
                    {round.messages.length === 0 ? (
                        <p className="text-[10px] text-agora-text-muted">
                            No messages in this round.
                        </p>
                    ) : (
                        round.messages.map((m) => {
                            const { status, warnings } = deriveParseStatus(
                                m.payload as Record<string, unknown> | undefined,
                            );
                            return (
                                <details
                                    key={m.id}
                                    className="rounded bg-agora-bg/40 border border-agora-border"
                                >
                                    <summary className="px-2 py-1.5 cursor-pointer text-[10px] text-agora-text-muted list-none flex items-center gap-2 select-none">
                                        <span className="text-[9px]">▶</span>
                                        <span>
                                            {m.sender_type === "judge"
                                                ? "moderator (synthesis verdict)"
                                                : (m.agent_role ?? "system")}
                                        </span>
                                        <span className="opacity-60">
                                            · seq {m.sequence_no}
                                        </span>
                                        <ParseStatusBadge
                                            status={status}
                                            warnings={warnings}
                                        />
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 space-y-2">
                                        {warnings.length > 0 && (
                                            <ul className="text-[10px] text-amber-300/90 space-y-0.5 pl-3 list-disc">
                                                {warnings.map((w, i) => (
                                                    <li key={i}>{w}</li>
                                                ))}
                                            </ul>
                                        )}
                                        <RawPayloadView data={m.payload ?? {}} />
                                    </div>
                                </details>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

// ── RawFollowupCycleCard ───────────────────────────────────────────────────

function RawFollowupCycleCard({
    cycle,
    rounds,
}: {
    cycle: number | string;
    rounds: RoundDTO[];
}) {
    const [open, setOpen] = useState(false);

    const cyclePayload = {
        cycle,
        rounds: rounds.map((r) => ({
            round_number: r.round_number,
            round_type: r.round_type,
            messages: r.messages.map((m) => ({
                agent_role: m.agent_role,
                message_type: m.message_type,
                sequence_no: m.sequence_no,
                payload: m.payload,
            })),
        })),
    };

    return (
        <div className="rounded-md border border-violet-500/30 bg-violet-500/5">
            <div className="px-3 py-2 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                >
                    <span
                        className={cn(
                            "text-[10px] text-violet-300 transition-transform shrink-0",
                            open && "rotate-90",
                        )}
                    >
                        ▶
                    </span>
                    <span className="text-[11px] font-semibold text-violet-200">
                        Follow-up Cycle {cycle}
                    </span>
                    <span className="text-[10px] text-violet-300/60">
                        {rounds.length} round{rounds.length !== 1 ? "s" : ""}
                    </span>
                </button>

                <CopyButton
                    label="Copy Cycle JSON"
                    onCopy={() => copyToClipboard(cyclePayload)}
                />
            </div>

            {open && (
                <div className="px-3 pb-3 space-y-2">
                    {rounds.map((r) => (
                        <RawRoundCard key={r.id} round={r} nested />
                    ))}
                </div>
            )}
        </div>
    );
}

function DebateProcessDiagnostics() {
    const session = useDebateStore((s) => s.session);
    const selectedCycle = usePlaybackStore((s) => s.selectedCycle);
    const { cycle, state: cycleState } = useSelectedCycleState();
    const process = useMemo(() => buildDebateProcessModel(session, selectedCycle), [session, selectedCycle]);

    if (!session?.latest_turn) return null;
    const d = process.diagnostics;

    return (
        <details className="rounded-md border border-amber-500/30 bg-amber-500/5 mb-2" open>
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                Debate Process Diagnostics
            </summary>
            <div className="px-3 pb-3">
                <div className="px-3 py-2 text-[11px] text-white/70 space-y-1 bg-black/20 rounded font-mono">
                    <div>Selected cycle: {cycle.cycleNumber}</div>
                    <div>Cycle type: {cycle.cycleType}</div>
                    <div>Cycle status: {cycleState.status}</div>
                    <div>Active stage: {cycleState.activeStageLabel ?? "none"}</div>
                    <div>Stuck suspected: {cycleState.isStuckSuspected ? "YES" : "NO"}</div>
                    <div>Missing stages: {cycleState.missingStages.join(", ") || "none"}</div>
                    <div>Current question: {cycle.question || "not loaded"}</div>
                    <div>Cycle rounds: {cycle.rounds.length}</div>
                    <div>Stage 1 messages: {d.stage1Count} ({d.hasStage1 ? "YES" : "NO"})</div>
                    <div>Stage 2 critiques: {d.stage2Count} ({d.hasStage2 ? "YES" : "NO"})</div>
                    <div>Stage 3 responses: {d.stage3Count} ({d.hasStage3 ? "YES" : "NO"})</div>
                    <div>Stage 4 revisions: {d.stage4Count} ({d.hasStage4 ? "YES" : "NO"})</div>
                    <div>Stage 5 synthesis messages: {d.stage5Count} ({d.hasStage5 ? "YES" : "NO"})</div>
                    <div>Moderator verdict: {process.round3.moderatorVerdict ? "YES" : "NO"}</div>
                    <div className="pt-2 text-amber-200">Round 3 Diagnostics:</div>
                    <div>Stage 5 status: {d.round3.stage5Status}</div>
                    <div>Agent synthesis messages: {d.round3.agentSynthesisMessages}</div>
                    <div>Moderator verdict found: {d.round3.moderatorVerdictFound ? "YES" : "NO"}</div>
                    <div>Moderator verdict source: {d.round3.moderatorVerdictSource?.location ?? "none"}</div>
                    <div>Verdict message id: {d.round3.moderatorVerdictSource?.messageId ?? "none"}</div>
                    <div>Verdict round id: {d.round3.moderatorVerdictSource?.roundId ?? "none"}</div>
                    <div>Verdict message_type: {d.round3.moderatorVerdictSource?.messageType ?? "none"}</div>
                    <div>Verdict sender_type: {d.round3.moderatorVerdictSource?.senderType ?? "none"}</div>
                    <div>Verdict fallback extraction used: {d.round3.fallbackExtractionUsed ? "YES" : "NO"}</div>
                    <div>Relationship metadata: {d.missingRelationshipMetadata ? "MISSING" : "COMPLETE"}</div>
                    <div>Fallback mapping used: {d.fallbackModeUsed ? "YES" : "NO"}</div>
                    <div>Relationship mapping mode: {d.relationshipMappingMode}</div>
                    <div className="pt-2 text-amber-200">Agent order:</div>
                    {d.agentOrder.map((agent, index) => (
                        <div key={`agent-${agent}`}>{index + 1}. {agent}</div>
                    ))}
                    <div className="pt-2 text-amber-200">Expected Stage 2:</div>
                    {d.expectedStage2.map((relation) => (
                        <div key={`expected-stage2-${relation}`}>{relation}</div>
                    ))}
                    <div className="pt-2 text-amber-200">Expected Stage 3:</div>
                    {d.expectedStage3.map((relation) => (
                        <div key={`expected-stage3-${relation}`}>{relation}</div>
                    ))}
                    <div className="pt-2 text-amber-200">Actual relationship mappings:</div>
                    {d.mappingDetails.map((item) => (
                        <div key={`${item.stage}-${item.relation}`}>
                            Stage {item.stage}: {item.relation} [{item.mappingSource}]
                            {item.payloadHint && item.payloadHint !== item.relation
                                ? ` | payload hint: ${item.payloadHint}`
                                : ""}
                        </div>
                    ))}
                </div>
            </div>
        </details>
    );
}

// ── RawOutputPanel (main) ──────────────────────────────────────────────────

export default function RawOutputPanel() {
    const turn = useDebateStore((s) => s.session?.latest_turn ?? null);
    const { cycle, state: cycleState } = useSelectedCycleState();
    const debateId = useDebateStore((s) => s.debateId);
    const lastEvent = useDebateStore((s) => s.lastWsEventType);
    const lastEventTimestamp = useDebateStore((s) => s.lastWsEventTimestamp);
    const view = useDebateViewState();

    const groups = useMemo(
        () => groupRounds(turn?.rounds ?? []),
        [turn?.rounds],
    );
    const latestCycleNumber = Math.max(
        1,
        ...(turn?.follow_ups ?? []).map((item) => item.cycle_number),
        ...(turn?.rounds ?? []).map((round) => round.cycle_number ?? 1),
    );
    const selectedError = cycle.cycleNumber === latestCycleNumber ? view.error : null;

    if (!turn) {
        return (
            <div className="w-full h-full bg-agora-surface/40 p-4 text-xs text-agora-text-muted">
                Raw output will appear once a debate is loaded.
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-agora-surface/40 flex flex-col">
            <div className="px-4 py-3 border-b border-agora-border">
                <h2 className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Raw Output
                </h2>
                <p className="text-[11px] text-agora-text-muted/80 mt-0.5">
                    Structured payloads from each round.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                <DebateProcessDiagnostics />
                <RawDebugBlock
                    data={{
                        debate_id: debateId,
                        selected_cycle: cycle.cycleNumber,
                        cycle_type: cycle.cycleType,
                        current_question: cycle.question,
                        cycle_status: cycleState.status,
                        turn_status: turn.status,
                        active_stage: cycleState.activeStageLabel ?? null,
                        progress_percent: cycleState.progressPercent,
                        missing_stages: cycleState.missingStages,
                        stuck_suspected: cycleState.isStuckSuspected,
                        polling_active:
                            cycleState.status === "queued"
                            || cycleState.status === "running"
                            || cycleState.isStuckSuspected
                            || turn.status === "queued"
                            || turn.status === "running",
                        response_count: cycle.stages.initialAnswers.length,
                        critique_count: cycle.stages.crossCritiques.length,
                        synthesis_count: cycle.stages.finalSynthesis.length,
                        round_records: cycle.rounds.map((round) => ({
                            round_type: round.round_type,
                            status: round.status,
                            message_count: round.messages.length,
                        })),
                        moderator_verdict_found: Boolean(cycle.stages.moderatorVerdict),
                        backend_status: view.backendStatus,
                        derived_frontend_status: view.derivedStatus,
                        current_stage: view.visibleStageLabel,
                        last_event_received: lastEvent,
                        last_event_timestamp: lastEventTimestamp,
                        request_id: turn.request_id ?? selectedError?.requestId ?? null,
                        error_code: selectedError?.code ?? null,
                        failed_phase: selectedError?.phase ?? null,
                        successful_agents: selectedError?.successfulAgents ?? [],
                        failed_agents: selectedError?.failedAgents ?? [],
                        partial_results_available: selectedError?.partialResultsAvailable ?? false,
                        retryable: selectedError?.retryable ?? false,
                    }}
                />
                {groups.length === 0 && (
                    <p className="text-xs text-agora-text-muted">
                        No rounds available yet.
                    </p>
                )}

                {groups.map((group) =>
                    group.kind === "base_round" ? (
                        <RawRoundCard
                            key={group.round.id}
                            round={group.round}
                        />
                    ) : (
                        <RawFollowupCycleCard
                            key={`cycle-${group.cycle}`}
                            cycle={group.cycle}
                            rounds={group.rounds}
                        />
                    ),
                )}
            </div>
        </div>
    );
}

function RawDebugBlock({ data }: { data: Record<string, unknown> }) {
    return (
        <details className="rounded-md border border-indigo-500/30 bg-indigo-500/5" open>
            <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-indigo-300">
                Lifecycle Debug
            </summary>
            <div className="px-3 pb-3">
                <RawPayloadView data={data} />
            </div>
        </details>
    );
}

