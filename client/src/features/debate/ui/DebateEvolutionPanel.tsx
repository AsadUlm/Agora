/**
 * DebateEvolutionPanel — Step 27.
 *
 * Renders the synthesis evolution across all cycles (original debate + each
 * follow-up cycle). Reads from `debate.store.session.latest_turn.rounds` and
 * extracts the synthesis-round payloads (round_type = "final" for cycle 1,
 * "updated_synthesis" for cycles 2+).
 *
 * For each cycle, displays:
 *   - Cycle label + question (when applicable)
 *   - Conclusion changed badge (yes/no)
 *   - Previous position → New position
 *   - Reason for shift / position_shift
 *   - Confidence
 *
 * Backward compatible: when the new evolution fields are missing (older
 * debates), falls back to the existing fields (final_position / what_changed).
 */
import { useMemo } from "react";
import { useDebateStore } from "../model/debate.store";
import { cn } from "@/shared/lib/cn";

type SynthesisPayload = Record<string, unknown>;

interface CycleEvolutionItem {
    cycleNumber: number;
    label: string;
    question: string;
    payload: SynthesisPayload | null;
}

function pickString(payload: SynthesisPayload | null, keys: string[]): string {
    if (!payload) return "";
    for (const key of keys) {
        const v = payload[key];
        if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
}

function pickStringList(payload: SynthesisPayload | null, key: string): string[] {
    if (!payload) return [];
    const v = payload[key];
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function pickConclusionChanged(payload: SynthesisPayload | null): "yes" | "no" | null {
    if (!payload) return null;
    const raw = (payload["conclusion_changed"] ?? "").toString().toLowerCase();
    if (raw === "yes") return "yes";
    if (raw === "no") return "no";
    return null;
}

function ChangeBadge({ value }: { value: "yes" | "no" | "initial" | null }) {
    if (value === null) return null;
    if (value === "initial") {
        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-indigo-500/15 text-indigo-200 border border-indigo-500/30">
                Initial position
            </span>
        );
    }
    if (value === "yes") {
        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-amber-500/15 text-amber-200 border border-amber-500/30">
                Position shifted
            </span>
        );
    }
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-emerald-500/10 text-emerald-200 border border-emerald-500/30">
            Position held
        </span>
    );
}

export default function DebateEvolutionPanel() {
    const session = useDebateStore((s) => s.session);
    const turn = session?.latest_turn ?? null;

    const items = useMemo<CycleEvolutionItem[]>(() => {
        if (!turn) return [];
        const followUps = turn.follow_ups ?? [];
        const result: CycleEvolutionItem[] = [];

        // Group rounds by cycle, find synthesis round for each cycle.
        const rounds = turn.rounds ?? [];
        const byCycle = new Map<number, typeof rounds>();
        for (const r of rounds) {
            const c = r.cycle_number ?? 1;
            const arr = byCycle.get(c) ?? [];
            arr.push(r);
            byCycle.set(c, arr);
        }

        const cycles = Array.from(byCycle.keys()).sort((a, b) => a - b);
        for (const cycle of cycles) {
            const roundsInCycle = byCycle.get(cycle) ?? [];
            const synthesisRound =
                roundsInCycle.find((r) => r.round_type === "final" || r.round_type === "updated_synthesis") ??
                null;
            // Representative payload: first agent's structured payload.
            let payload: SynthesisPayload | null = null;
            if (synthesisRound) {
                for (const m of synthesisRound.messages) {
                    if (m.payload && typeof m.payload === "object" && Object.keys(m.payload).length > 0) {
                        payload = m.payload as SynthesisPayload;
                        break;
                    }
                }
            }

            const label =
                cycle === 1
                    ? "Original Debate"
                    : `Follow-up #${cycle - 1}`;
            const question =
                cycle === 1
                    ? turn.user_message?.content ?? session?.question ?? ""
                    : followUps.find((f) => f.cycle_number === cycle)?.question ?? "";

            result.push({ cycleNumber: cycle, label, question, payload });
        }
        return result;
    }, [turn, session]);

    if (!turn) {
        return (
            <div className="w-full h-full bg-agora-surface/40 p-4 text-xs text-agora-text-muted">
                Evolution view will appear once a debate is loaded.
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="w-full h-full bg-agora-surface/40 p-4 text-xs text-agora-text-muted">
                No synthesis available yet. Run the debate to see how the conclusion evolves.
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-agora-surface/40 flex flex-col">
            <div className="px-4 py-3 border-b border-agora-border">
                <h2 className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Debate Evolution
                </h2>
                <p className="text-[11px] text-agora-text-muted/80 mt-0.5">
                    How the synthesis position changed across {items.length} cycle{items.length === 1 ? "" : "s"}.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {items.map((item, idx) => {
                    const conclusion =
                        pickString(item.payload, [
                            "updated_conclusion",
                            "policy_direction",
                            "final_position",
                            "conclusion",
                            "short_summary",
                            "one_sentence_takeaway",
                        ]) || "(no conclusion recorded)";
                    const positionShift = pickString(item.payload, [
                        "position_shift",
                        "change_reason",
                        "what_changed",
                    ]);
                    const previousPos = pickString(item.payload, [
                        "previous_position",
                    ]);
                    const newPos = pickString(item.payload, [
                        "new_position",
                        "updated_conclusion",
                        "final_position",
                    ]);
                    const consensus = pickString(item.payload, ["core_consensus", "consensus"]);
                    const tradeoffs = pickStringList(item.payload, "risk_tradeoffs");
                    const unresolved = pickStringList(item.payload, "unresolved_questions");
                    const confidence = pickString(item.payload, ["confidence_level", "confidence"]);

                    const changeBadgeValue: "yes" | "no" | "initial" | null =
                        idx === 0 ? "initial" : pickConclusionChanged(item.payload);

                    const isLast = idx === items.length - 1;

                    return (
                        <div key={item.cycleNumber} className="relative">
                            {/* connector line */}
                            {!isLast && (
                                <div className="absolute left-3 top-8 bottom-[-12px] w-px bg-violet-500/20" aria-hidden />
                            )}
                            <div
                                className={cn(
                                    "relative rounded-lg border bg-agora-surface-light/40 p-3 space-y-2.5",
                                    idx === items.length - 1
                                        ? "border-violet-500/40"
                                        : "border-agora-border",
                                )}
                            >
                                {/* dot */}
                                <div
                                    className={cn(
                                        "absolute -left-[7px] top-3 h-3 w-3 rounded-full border-2",
                                        idx === items.length - 1
                                            ? "bg-violet-500 border-violet-300"
                                            : "bg-agora-surface border-violet-500/50",
                                    )}
                                    aria-hidden
                                />
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[11px] font-semibold text-white truncate">{item.label}</span>
                                        {confidence && (
                                            <span className="px-1.5 py-0.5 rounded bg-agora-surface-light/70 text-[9px] uppercase tracking-wide text-agora-text-muted border border-agora-border">
                                                {confidence}
                                            </span>
                                        )}
                                    </div>
                                    <ChangeBadge value={changeBadgeValue} />
                                </div>

                                {item.question && (
                                    <p className="text-[11px] text-agora-text-muted line-clamp-2 italic">
                                        &ldquo;{item.question}&rdquo;
                                    </p>
                                )}

                                <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-2.5 py-2">
                                    <div className="text-[9px] uppercase tracking-widest text-violet-300 font-semibold mb-0.5">
                                        Conclusion
                                    </div>
                                    <p className="text-[12px] text-white leading-relaxed text-justify">{conclusion}</p>
                                </div>

                                {(previousPos || newPos) && idx > 0 && (
                                    <div className="space-y-1">
                                        {previousPos && (
                                            <div className="text-[11px] text-agora-text-muted">
                                                <span className="uppercase text-[9px] tracking-widest text-agora-text-muted/70 mr-1">From:</span>
                                                {previousPos}
                                            </div>
                                        )}
                                        {newPos && newPos !== previousPos && (
                                            <div className="text-[11px] text-agora-text">
                                                <span className="uppercase text-[9px] tracking-widest text-violet-300 mr-1">To:</span>
                                                {newPos}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {positionShift && idx > 0 && (
                                    <div>
                                        <div className="text-[9px] uppercase tracking-widest text-agora-text-muted font-semibold mb-0.5">
                                            Reason for shift
                                        </div>
                                        <p className="text-[11px] text-agora-text-muted leading-relaxed text-justify">{positionShift}</p>
                                    </div>
                                )}

                                {consensus && (
                                    <div className="text-[11px] text-emerald-300/90">
                                        <span className="uppercase text-[9px] tracking-widest mr-1">Consensus:</span>
                                        {consensus}
                                    </div>
                                )}

                                {tradeoffs.length > 0 && (
                                    <div>
                                        <div className="text-[9px] uppercase tracking-widest text-amber-300/80 font-semibold mb-0.5">
                                            Trade-offs
                                        </div>
                                        <ul className="space-y-0.5 text-[11px] text-agora-text-muted">
                                            {tradeoffs.slice(0, 3).map((t, i) => (
                                                <li key={i}>• {t}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {unresolved.length > 0 && (
                                    <div>
                                        <div className="text-[9px] uppercase tracking-widest text-rose-300/80 font-semibold mb-0.5">
                                            Unresolved
                                        </div>
                                        <ul className="space-y-0.5 text-[11px] text-agora-text-muted">
                                            {unresolved.slice(0, 3).map((t, i) => (
                                                <li key={i}>• {t}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
