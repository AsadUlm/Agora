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

// ── Constants ──────────────────────────────────────────────────────────────

const FOLLOWUP_TYPES = new Set([
    "followup_response",
    "followup_critique",
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
                        Round {round.round_number}
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

// ── RawOutputPanel (main) ──────────────────────────────────────────────────

export default function RawOutputPanel() {
    const turn = useDebateStore((s) => s.session?.latest_turn ?? null);

    const groups = useMemo(
        () => groupRounds(turn?.rounds ?? []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [turn?.rounds],
    );

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

