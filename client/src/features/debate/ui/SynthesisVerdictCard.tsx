/**
 * SynthesisVerdictCard — Step 37.
 *
 * Renders the neutral moderator verdict that aggregates the three agent
 * syntheses for one cycle (Round 3 for cycle 1, Updated Synthesis for
 * follow-up cycles). The card is shown ABOVE the existing per-agent
 * summaries in `DebateEvolutionPanel` — it never replaces them.
 *
 * The verdict payload is produced by `_normalize_synthesis_verdict` on the
 * backend and persisted as a judge message inside the synthesis round.
 */
import { cn } from "@/shared/lib/cn";

export interface SynthesisVerdictPayload {
    one_sentence_takeaway?: string;
    consensus_statement?: string;
    main_disagreement?: string;
    recommended_answer?: string;
    winning_side?: string;
    confidence?: string;
    what_changed?: string;
    reasoning_basis?: unknown;
    unresolved_questions?: unknown;
    response?: string;
    parse_status?: string;
    parse_warnings?: unknown;
    is_fallback?: boolean;
    [key: string]: unknown;
}

interface Props {
    payload: SynthesisVerdictPayload;
    cycleNumber: number;
    followupQuestion?: string;
}

const WINNING_SIDE_STYLES: Record<string, string> = {
    analyst: "bg-blue-500/15 text-blue-200 border-blue-500/40",
    critic: "bg-red-500/15 text-red-200 border-red-500/40",
    creative: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
    draw: "bg-slate-500/15 text-slate-200 border-slate-500/40",
    mixed: "bg-violet-500/15 text-violet-200 border-violet-500/40",
};

const CONFIDENCE_STYLES: Record<string, string> = {
    low: "bg-amber-500/15 text-amber-200 border-amber-500/40",
    medium: "bg-indigo-500/15 text-indigo-200 border-indigo-500/40",
    high: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
};

function asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
}

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export default function SynthesisVerdictCard({
    payload,
    cycleNumber,
    followupQuestion,
}: Props) {
    const isFollowUp = cycleNumber > 1;
    const title = isFollowUp
        ? `Updated Overall Verdict — Follow-up Cycle ${cycleNumber - 1}`
        : "Overall Synthesis Verdict";

    const takeaway = asString(payload.one_sentence_takeaway);
    const recommended = asString(payload.recommended_answer);
    const consensus = asString(payload.consensus_statement);
    const disagreement = asString(payload.main_disagreement);
    const whatChanged = asString(payload.what_changed);
    const response = asString(payload.response);
    const reasoning = asStringList(payload.reasoning_basis);
    const unresolved = asStringList(payload.unresolved_questions);

    const winningSide = asString(payload.winning_side).toLowerCase();
    const confidence = asString(payload.confidence).toLowerCase();
    const winningStyle = WINNING_SIDE_STYLES[winningSide] ?? WINNING_SIDE_STYLES.mixed;
    const confidenceStyle = CONFIDENCE_STYLES[confidence] ?? CONFIDENCE_STYLES.medium;

    const parseStatus = asString(payload.parse_status).toLowerCase();
    const isFallback = payload.is_fallback === true;
    const warnings = asStringList(payload.parse_warnings);
    const showFallbackBadge = isFallback || parseStatus === "fallback";
    const showRecoveredBadge = parseStatus === "recovered" || parseStatus === "partial";

    return (
        <div className="rounded-xl border border-violet-500/40 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-4 space-y-3 shadow-lg shadow-violet-500/5">
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="space-y-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">
                        Moderator
                    </div>
                    <h3 className="text-sm font-semibold text-white leading-tight">
                        {title}
                    </h3>
                    {isFollowUp && followupQuestion && (
                        <p className="text-[11px] italic text-violet-200/80 line-clamp-2">
                            “{followupQuestion}”
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {winningSide && (
                        <span
                            className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wide",
                                winningStyle,
                            )}
                            title="Which side prevailed in the moderator's view"
                        >
                            {winningSide}
                        </span>
                    )}
                    {confidence && (
                        <span
                            className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wide",
                                confidenceStyle,
                            )}
                            title="Moderator confidence in the aggregated verdict"
                        >
                            {confidence} confidence
                        </span>
                    )}
                    {showFallbackBadge && (
                        <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-red-500/40 bg-red-500/10 text-red-300 uppercase tracking-wide"
                            title={warnings.length > 0 ? warnings.join("\n") : undefined}
                        >
                            fallback
                        </span>
                    )}
                    {!showFallbackBadge && showRecoveredBadge && (
                        <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-blue-500/40 bg-blue-500/10 text-blue-300 uppercase tracking-wide"
                            title={warnings.length > 0 ? warnings.join("\n") : undefined}
                        >
                            {parseStatus}
                        </span>
                    )}
                </div>
            </div>

            {takeaway && (
                <div className="rounded-lg bg-violet-500/15 border border-violet-500/25 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-violet-300 font-semibold mb-1">
                        Takeaway
                    </div>
                    <p className="text-[13px] text-white font-medium leading-relaxed">
                        {takeaway}
                    </p>
                </div>
            )}

            {recommended && (
                <div>
                    <div className="text-[9px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                        Recommended Answer
                    </div>
                    <p className="text-[12px] text-white leading-relaxed text-justify whitespace-pre-line">
                        {recommended}
                    </p>
                </div>
            )}

            {(consensus || disagreement) && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {consensus && (
                        <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-widest text-emerald-300/90 font-semibold mb-1">
                                Consensus
                            </div>
                            <p className="text-[11px] text-emerald-100 leading-relaxed">
                                {consensus}
                            </p>
                        </div>
                    )}
                    {disagreement && (
                        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
                            <div className="text-[9px] uppercase tracking-widest text-amber-300/90 font-semibold mb-1">
                                Main Disagreement
                            </div>
                            <p className="text-[11px] text-amber-100 leading-relaxed">
                                {disagreement}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {isFollowUp && whatChanged && (
                <div>
                    <div className="text-[9px] uppercase tracking-widest text-violet-300 font-semibold mb-1">
                        What Changed Since Last Cycle
                    </div>
                    <p className="text-[11px] text-agora-text leading-relaxed">
                        {whatChanged}
                    </p>
                </div>
            )}

            {reasoning.length > 0 && (
                <div>
                    <div className="text-[9px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                        Reasoning Basis
                    </div>
                    <ul className="space-y-1">
                        {reasoning.map((item, idx) => (
                            <li
                                key={idx}
                                className="text-[11px] text-agora-text-muted flex items-start gap-1.5 leading-relaxed"
                            >
                                <span className="text-violet-300 mt-0.5">›</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {unresolved.length > 0 && (
                <div>
                    <div className="text-[9px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1">
                        Unresolved Questions
                    </div>
                    <ul className="space-y-1">
                        {unresolved.map((item, idx) => (
                            <li
                                key={idx}
                                className="text-[11px] text-agora-text-muted flex items-start gap-1.5 leading-relaxed"
                            >
                                <span className="text-amber-300/80 mt-0.5">?</span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {response && response !== recommended && (
                <details className="rounded-md border border-agora-border/60 bg-agora-surface-light/20">
                    <summary className="px-2.5 py-1.5 text-[10px] text-agora-text-muted cursor-pointer select-none">
                        Full moderator narrative
                    </summary>
                    <p className="px-2.5 pb-2.5 pt-1 text-[11px] text-agora-text leading-relaxed whitespace-pre-line text-justify">
                        {response}
                    </p>
                </details>
            )}
        </div>
    );
}

/**
 * Detect whether a message payload represents a synthesis_verdict.
 *
 * Backend embeds ``message_type: "synthesis_verdict"`` and ``agent_role:
 * "moderator"`` directly inside the JSON payload (no DB schema change), so
 * we identify the verdict purely from the payload contents. The DTO-level
 * ``message_type`` stays ``final_summary`` for backward compatibility.
 */
export function isSynthesisVerdictPayload(
    payload: Record<string, unknown> | null | undefined,
): payload is SynthesisVerdictPayload {
    if (!payload || typeof payload !== "object") return false;
    const innerType = payload["message_type"];
    if (typeof innerType === "string" && innerType === "synthesis_verdict") {
        return true;
    }
    const role = payload["agent_role"];
    if (typeof role === "string" && role.toLowerCase() === "moderator") {
        return true;
    }
    return false;
}
