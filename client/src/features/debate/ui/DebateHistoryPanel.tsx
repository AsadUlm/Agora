/**
 * DebateHistoryPanel — "Debate Flow" view.
 *
 * Top section: Argument Chains — visual per-critique chains:
 *   [Initial Position] → [Critique] → [Response] → [Revised Position]
 *
 * Bottom section: Chronological 5-stage detail:
 *   Phase 1 · Stage 1 — Initial Positions
 *   Phase 2 · Stage 2 — Cross-Critiques
 *   Phase 2 · Stage 3 — Responses to Critiques
 *   Phase 2 · Stage 4 — Revised Positions
 *   Phase 3 · Stage 5 — Final Synthesis
 *
 * This is the primary evidence tab proving a real debate happened.
 */
import { useState } from "react";
import { useDebateStore } from "../model/debate.store";
import type {
    CritiqueTraceItem,
    CritiqueResponseTraceItem,
    RevisedPositionTraceItem,
    DebateTrace,
    MessageDTO,
    RoundDTO,
} from "../api/debate.types";
import { cn } from "@/shared/lib/cn";

// ── Color palette for agents ──────────────────────────────────────────────────
const AGENT_COLORS = [
    "border-l-indigo-400 bg-indigo-500/5",
    "border-l-emerald-400 bg-emerald-500/5",
    "border-l-amber-400 bg-amber-500/5",
    "border-l-rose-400 bg-rose-500/5",
    "border-l-sky-400 bg-sky-500/5",
];

const AGENT_BADGE_COLORS = [
    "bg-indigo-500/20 text-indigo-200 border-indigo-500/30",
    "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    "bg-amber-500/20 text-amber-200 border-amber-500/30",
    "bg-rose-500/20 text-rose-200 border-rose-500/30",
    "bg-sky-500/20 text-sky-200 border-sky-500/30",
];

function agentColorIndex(name: string, agents: string[]): number {
    const idx = agents.indexOf(name);
    return idx >= 0 ? idx % AGENT_COLORS.length : 0;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ title, count, icon }: { title: string; count: number; icon: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-base">{icon}</span>
            <h3 className="text-sm font-semibold text-white/90 tracking-wide uppercase">{title}</h3>
            <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/50">
                {count} item{count !== 1 ? "s" : ""}
            </span>
        </div>
    );
}

function ExpandableCard({
    children,
    summary,
    defaultOpen = false,
}: {
    children: React.ReactNode;
    summary: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border border-white/10 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full text-left px-4 py-3 flex items-start gap-2 hover:bg-white/5 transition-colors"
            >
                <span className="mt-0.5 text-white/40 text-xs shrink-0">{open ? "▼" : "▶"}</span>
                <div className="flex-1 min-w-0">{summary}</div>
            </button>
            {open && <div className="px-4 pb-4 border-t border-white/10">{children}</div>}
        </div>
    );
}

function AgentBadge({ name, agents }: { name: string; agents: string[] }) {
    const idx = agentColorIndex(name, agents);
    return (
        <span className={cn("px-2 py-0.5 rounded text-[11px] font-semibold border", AGENT_BADGE_COLORS[idx])}>
            {name}
        </span>
    );
}

// ── Round 1: Initial Positions ────────────────────────────────────────────────

function InitialPositionItem({
    msg,
    agents,
}: {
    msg: MessageDTO;
    agents: string[];
}) {
    const payload = msg.payload as Record<string, unknown>;
    const role = msg.agent_role ?? "Agent";
    const summary = (payload.short_summary ?? payload.main_argument ?? payload.stance ?? "") as string;
    const fullContent = (payload.response ?? payload.reasoning ?? msg.text ?? "") as string;
    const keyPoints = Array.isArray(payload.key_points) ? (payload.key_points as string[]) : [];
    const confidence = (payload.confidence ?? "") as string;

    const idx = agentColorIndex(role, agents);
    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <AgentBadge name={role} agents={agents} />
                        {confidence && (
                            <span className="text-[10px] text-white/40">confidence: {confidence}</span>
                        )}
                    </div>
                    {summary && (
                        <p className="text-xs text-white/70 line-clamp-2">{summary}</p>
                    )}
                </div>
            }
        >
            <div className={cn("mt-3 pl-3 border-l-2 space-y-3", AGENT_COLORS[idx].split(" ")[0])}>
                {keyPoints.length > 0 && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Key claims</p>
                        <ul className="space-y-1">
                            {keyPoints.map((pt, i) => (
                                <li key={i} className="text-xs text-white/70 flex gap-2">
                                    <span className="text-white/30 shrink-0">•</span>
                                    <span>{pt}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {fullContent && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Full position</p>
                        <p className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap">{fullContent}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// ── Round 2: Cross-Critiques ──────────────────────────────────────────────────

function CritiqueItem({ c, agents }: { c: CritiqueTraceItem; agents: string[] }) {
    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <AgentBadge name={c.from_agent_name} agents={agents} />
                        <span className="text-white/40 text-xs">→ critiques →</span>
                        <AgentBadge name={c.to_agent_name} agents={agents} />
                    </div>
                    {c.critique_summary && (
                        <p className="text-xs text-white/70 line-clamp-2">{c.critique_summary}</p>
                    )}
                </div>
            }
        >
            <div className="mt-3 space-y-3">
                {c.target_claim && (
                    <div>
                        <p className="text-[11px] font-semibold text-amber-400/70 uppercase tracking-wide mb-1">Target claim</p>
                        <p className="text-xs text-white/80 italic">"{c.target_claim}"</p>
                    </div>
                )}
                {c.weakness_found && (
                    <div>
                        <p className="text-[11px] font-semibold text-rose-400/70 uppercase tracking-wide mb-1">Weakness identified</p>
                        <p className="text-xs text-white/70">{c.weakness_found}</p>
                    </div>
                )}
                {c.critique_summary && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Critique</p>
                        <p className="text-xs text-white/80 leading-relaxed">{c.critique_summary}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// Fallback: render from round messages when trace not available
function CritiqueItemFromMessage({ msg, agents }: { msg: MessageDTO; agents: string[] }) {
    const payload = msg.payload as Record<string, unknown>;
    const role = msg.agent_role ?? "Agent";
    const targetAgent = (payload.target_agent ?? "") as string;
    const summary = (payload.short_summary ?? payload.one_sentence_takeaway ?? "") as string;
    const weakness = (payload.weakness_found ?? "") as string;
    const challenge = (payload.challenge ?? "") as string;

    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <AgentBadge name={role} agents={agents} />
                        <span className="text-white/40 text-xs">→ critiques →</span>
                        {targetAgent ? (
                            <AgentBadge name={targetAgent} agents={agents} />
                        ) : (
                            <span className="text-white/40 text-xs">Unknown target</span>
                        )}
                    </div>
                    {summary && <p className="text-xs text-white/70 line-clamp-2">{summary}</p>}
                </div>
            }
        >
            <div className="mt-3 space-y-3">
                {challenge && (
                    <div>
                        <p className="text-[11px] font-semibold text-amber-400/70 uppercase tracking-wide mb-1">Target claim</p>
                        <p className="text-xs text-white/80 italic">"{challenge}"</p>
                    </div>
                )}
                {weakness && (
                    <div>
                        <p className="text-[11px] font-semibold text-rose-400/70 uppercase tracking-wide mb-1">Weakness</p>
                        <p className="text-xs text-white/70">{weakness}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// ── Round 3: Critique Responses ───────────────────────────────────────────────

function CritiqueResponseItem({ r, agents }: { r: CritiqueResponseTraceItem; agents: string[] }) {
    const stanceColor = {
        unchanged: "text-slate-400",
        slightly_revised: "text-amber-400",
        significantly_revised: "text-orange-400",
        reversed: "text-rose-400",
    }[r.stance_update ?? "unchanged"] ?? "text-white/40";

    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <AgentBadge name={r.agent_name} agents={agents} />
                        <span className={cn("text-[11px] font-medium", stanceColor)}>
                            {r.stance_update ?? "unchanged"}
                        </span>
                    </div>
                    {r.received_critique_summary && (
                        <p className="text-xs text-white/60 line-clamp-2 italic">
                            Received: "{r.received_critique_summary}"
                        </p>
                    )}
                </div>
            }
        >
            <div className="mt-3 space-y-3">
                {r.response && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Response</p>
                        <p className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap">{r.response}</p>
                    </div>
                )}
                {r.accepted_points.length > 0 && (
                    <div>
                        <p className="text-[11px] font-semibold text-emerald-400/70 uppercase tracking-wide mb-1">
                            ✓ Accepted points
                        </p>
                        <ul className="space-y-1">
                            {r.accepted_points.map((pt, i) => (
                                <li key={i} className="text-xs text-white/70 flex gap-2">
                                    <span className="text-emerald-400 shrink-0">✓</span>
                                    <span>{pt}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {r.rejected_points.length > 0 && (
                    <div>
                        <p className="text-[11px] font-semibold text-rose-400/70 uppercase tracking-wide mb-1">
                            ✗ Rejected points
                        </p>
                        <ul className="space-y-1">
                            {r.rejected_points.map((pt, i) => (
                                <li key={i} className="text-xs text-white/70 flex gap-2">
                                    <span className="text-rose-400 shrink-0">✗</span>
                                    <span>{pt}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {r.planned_revision && (
                    <div>
                        <p className="text-[11px] font-semibold text-indigo-400/70 uppercase tracking-wide mb-1">
                            Planned revision
                        </p>
                        <p className="text-xs text-white/70 italic">{r.planned_revision}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// Fallback: render from round messages
function CritiqueResponseFromMessage({ msg, agents }: { msg: MessageDTO; agents: string[] }) {
    const payload = msg.payload as Record<string, unknown>;
    const role = msg.agent_role ?? "Agent";
    const summary = (payload.received_critique_summary ?? "") as string;
    const response = (payload.response ?? msg.text ?? "") as string;

    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <AgentBadge name={role} agents={agents} />
                    {summary && <p className="text-xs text-white/60 italic line-clamp-2">Received: "{summary}"</p>}
                </div>
            }
        >
            <div className="mt-3">
                <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Response</p>
                <p className="text-xs text-white/80 leading-relaxed">{response}</p>
            </div>
        </ExpandableCard>
    );
}

// ── Round 4: Revised Positions ────────────────────────────────────────────────

function RevisedPositionItem({ r, agents }: { r: RevisedPositionTraceItem; agents: string[] }) {
    const idx = agentColorIndex(r.agent_name, agents);
    const changeColor = r.changed ? "text-amber-300" : "text-emerald-400";

    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <AgentBadge name={r.agent_name} agents={agents} />
                        <span className={cn("text-[11px] font-medium", changeColor)}>
                            {r.changed ? `Changed (${r.change_type || "revised"})` : "Position held"}
                        </span>
                    </div>
                    {r.change_summary && (
                        <p className="text-xs text-white/60 line-clamp-2">{r.change_summary}</p>
                    )}
                </div>
            }
        >
            <div className={cn("mt-3 pl-3 border-l-2 space-y-4", AGENT_COLORS[idx].split(" ")[0])}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">Before</p>
                        <p className="text-xs text-white/60 leading-relaxed">{r.initial_position_summary}</p>
                    </div>
                    <div>
                        <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wide mb-1">After</p>
                        <p className="text-xs text-white/80 leading-relaxed">{r.revised_position}</p>
                    </div>
                </div>
                {r.reason_for_change && (
                    <div>
                        <p className="text-[11px] font-semibold text-indigo-400/70 uppercase tracking-wide mb-1">
                            Why {r.changed ? "changed" : "unchanged"}
                        </p>
                        <p className="text-xs text-white/70">{r.reason_for_change}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// Fallback: render from round messages
function RevisedPositionFromMessage({ msg, agents }: { msg: MessageDTO; agents: string[] }) {
    const payload = msg.payload as Record<string, unknown>;
    const role = msg.agent_role ?? "Agent";
    const changed = Boolean(payload.changed);
    const changeSummary = (payload.change_summary ?? "") as string;
    const revisedPos = (payload.revised_position ?? payload.response ?? msg.text ?? "") as string;
    const initialSummary = (payload.initial_position_summary ?? "") as string;
    const reason = (payload.reason_for_change ?? "") as string;

    return (
        <ExpandableCard
            summary={
                <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <AgentBadge name={role} agents={agents} />
                        <span className={cn("text-[11px] font-medium", changed ? "text-amber-300" : "text-emerald-400")}>
                            {changed ? "Changed" : "Position held"}
                        </span>
                    </div>
                    {changeSummary && <p className="text-xs text-white/60 line-clamp-2">{changeSummary}</p>}
                </div>
            }
        >
            <div className="mt-3 space-y-3">
                {initialSummary && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">Before</p>
                        <p className="text-xs text-white/60">{initialSummary}</p>
                    </div>
                )}
                <div>
                    <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wide mb-1">After</p>
                    <p className="text-xs text-white/80 leading-relaxed">{revisedPos}</p>
                </div>
                {reason && (
                    <div>
                        <p className="text-[11px] font-semibold text-indigo-400/70 uppercase tracking-wide mb-1">
                            Reason
                        </p>
                        <p className="text-xs text-white/70">{reason}</p>
                    </div>
                )}
            </div>
        </ExpandableCard>
    );
}

// ── Round 5: Final Synthesis ──────────────────────────────────────────────────

function FinalSynthesisSection({ round }: { round: RoundDTO }) {
    const finalMsg = round.messages.find((m) => m.message_type === "final_summary");
    const verdictMsg = round.messages.find(
        (m) => (m.payload as Record<string, unknown>)?.message_type === "synthesis_verdict"
    );
    const agentMsgs = round.messages.filter((m) => m.message_type === "final_summary" && m.agent_id);

    const verdictPayload = verdictMsg?.payload as Record<string, unknown> | undefined;
    const verdict =
        verdictPayload?.verdict_summary ??
        verdictPayload?.synthesis_answer ??
        verdictPayload?.answer ??
        "";

    return (
        <div className="space-y-3">
            {verdictMsg && verdict ? (
                <div className="p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
                    <p className="text-[11px] font-semibold text-violet-300 uppercase tracking-wide mb-2">
                        Moderator Synthesis
                    </p>
                    <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">{String(verdict)}</p>
                </div>
            ) : finalMsg ? (
                <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                    <p className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap">
                        {String((finalMsg.payload as Record<string, unknown>)?.response ?? finalMsg.text ?? "")}
                    </p>
                </div>
            ) : null}
            {agentMsgs.length > 1 && (
                <div className="text-[11px] text-white/40 italic">
                    {agentMsgs.length} agent syntheses contributed to the final answer.
                </div>
            )}
        </div>
    );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptySection({ message }: { message: string }) {
    return (
        <div className="py-6 text-center text-xs text-white/30 italic">{message}</div>
    );
}

/** Shown when a required 5-stage pipeline round is missing from the debate data. */
function IncompleteStageWarning({ stage }: { stage: string }) {
    return (
        <div className="py-3 px-3 rounded-lg border border-amber-500/30 bg-amber-500/8">
            <div className="flex items-start gap-2">
                <span className="text-amber-400 text-sm shrink-0">⚠️</span>
                <div>
                    <p className="text-[12px] font-semibold text-amber-300">
                        This debate trace is incomplete: {stage} were not generated.
                    </p>
                    <p className="text-[11px] text-amber-200/60 mt-0.5">
                        This debate may have been run before the 5-stage pipeline was enabled,
                        or generation stopped before this stage completed.
                    </p>
                </div>
            </div>
        </div>
    );
}

// ── Argument Chain View ───────────────────────────────────────────────────────

type ChangeDisplay = "Changed" | "Partially changed" | "Strengthened" | "Unchanged" | "Unclear";

const CHANGE_TYPE_LABEL: Record<string, ChangeDisplay> = {
    narrowed_position: "Partially changed",
    expanded_position: "Strengthened",
    changed_stance: "Changed",
    added_condition: "Strengthened",
    resolved_uncertainty: "Strengthened",
    other: "Changed",
};

function ArgumentChainCard({
    critique,
    response,
    revision,
    initialSummary,
    agents,
}: {
    critique: CritiqueTraceItem;
    response?: CritiqueResponseTraceItem;
    revision?: RevisedPositionTraceItem;
    initialSummary?: string;
    agents: string[];
}) {
    const [expanded, setExpanded] = useState(false);

    const changed = revision?.changed ?? null;
    const changeLabel: ChangeDisplay =
        changed === null ? "Unclear"
        : changed === false ? "Unchanged"
        : CHANGE_TYPE_LABEL[revision?.change_type ?? ""] ?? "Changed";

    const changeBadgeColor =
        changeLabel === "Unchanged" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
        : changeLabel === "Unclear"  ? "bg-white/10 text-white/40 border-white/20"
        : "bg-amber-500/15 text-amber-300 border-amber-500/30";

    const criticIdx = agents.indexOf(critique.from_agent_name);
    const targetIdx = agents.indexOf(critique.to_agent_name);
    const criticColor = ["text-indigo-300","text-emerald-300","text-amber-300","text-rose-300","text-sky-300"][Math.max(0, criticIdx) % 5];
    const targetColor = ["text-indigo-300","text-emerald-300","text-amber-300","text-rose-300","text-sky-300"][Math.max(0, targetIdx) % 5];
    const criticBg = ["bg-indigo-500/15 border-indigo-500/30","bg-emerald-500/15 border-emerald-500/30","bg-amber-500/15 border-amber-500/30","bg-rose-500/15 border-rose-500/30","bg-sky-500/15 border-sky-500/30"][Math.max(0, criticIdx) % 5];
    const targetBg = ["bg-indigo-500/15 border-indigo-500/30","bg-emerald-500/15 border-emerald-500/30","bg-amber-500/15 border-amber-500/30","bg-rose-500/15 border-rose-500/30","bg-sky-500/15 border-sky-500/30"][Math.max(0, targetIdx) % 5];

    return (
        <div className="rounded-xl border border-white/10 bg-white/3 overflow-hidden">
            {/* Chain header */}
            <button
                className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors flex items-start gap-2"
                onClick={() => setExpanded((v) => !v)}
            >
                <span className="mt-0.5 text-white/30 text-xs shrink-0">{expanded ? "▼" : "▶"}</span>
                <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-semibold", criticBg, criticColor)}>
                            {critique.from_agent_name}
                        </span>
                        <span className="text-[10px] text-white/40">challenged</span>
                        <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-semibold", targetBg, targetColor)}>
                            {critique.to_agent_name}
                        </span>
                        <span className={cn("ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full border", changeBadgeColor)}>
                            {changeLabel}
                        </span>
                    </div>
                    {critique.target_claim && (
                        <p className="text-[10px] text-amber-200/60 italic leading-snug line-clamp-2">
                            Claim: "{critique.target_claim}"
                        </p>
                    )}
                    {!expanded && critique.critique_summary && (
                        <p className="text-[10px] text-white/45 leading-snug line-clamp-1">
                            {critique.critique_summary}
                        </p>
                    )}
                </div>
            </button>

            {/* Expanded chain */}
            {expanded && (
                <div className="px-3 pb-3 border-t border-white/10 pt-2 space-y-0">
                    {/* Step 1: Initial claim */}
                    {initialSummary && (
                        <ChainStep
                            stepIcon="💬"
                            stepLabel={`Initial position — ${critique.to_agent_name}`}
                            content={initialSummary}
                            connector
                            connectorLabel="challenged by"
                        />
                    )}

                    {/* Step 2: Critique */}
                    <ChainStep
                        stepIcon="⚔️"
                        stepLabel={`Critique by ${critique.from_agent_name}`}
                        content={critique.critique_summary}
                        subContent={critique.weakness_found ? `Weakness: ${critique.weakness_found}` : undefined}
                        connector={!!response}
                        connectorLabel="responded"
                        colorClass="text-rose-300"
                    />

                    {/* Step 3: Response */}
                    {response && (
                        <ChainStep
                            stepIcon="💬"
                            stepLabel={`Response by ${critique.to_agent_name}`}
                            content={response.response}
                            subContent={
                                response.accepted_points.length > 0
                                    ? `Accepted: ${response.accepted_points[0]}`
                                    : undefined
                            }
                            connector={!!revision}
                            connectorLabel="revised"
                            colorClass="text-sky-300"
                        />
                    )}

                    {/* Step 4: Revised position */}
                    {revision && (
                        <ChainStep
                            stepIcon={revision.changed ? "🔄" : "🛡️"}
                            stepLabel={`Revised position — ${revision.agent_name}`}
                            content={revision.revised_position || revision.change_summary}
                            connector={false}
                            colorClass={revision.changed ? "text-amber-300" : "text-emerald-300"}
                            badge={changeLabel}
                            badgeColor={changeBadgeColor}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function ChainStep({
    stepIcon,
    stepLabel,
    content,
    subContent,
    connector,
    connectorLabel,
    colorClass = "text-white/60",
    badge,
    badgeColor,
}: {
    stepIcon: string;
    stepLabel: string;
    content: string;
    subContent?: string;
    connector?: boolean;
    connectorLabel?: string;
    colorClass?: string;
    badge?: string;
    badgeColor?: string;
}) {
    return (
        <div>
            <div className="flex gap-2 pt-2">
                <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
                    <span className="text-sm">{stepIcon}</span>
                    {connector && <div className="flex-1 w-px bg-white/15 my-1" />}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className={cn("text-[10px] font-semibold uppercase tracking-wide", colorClass)}>
                            {stepLabel}
                        </p>
                        {badge && (
                            <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full border", badgeColor ?? "")}>
                                {badge}
                            </span>
                        )}
                    </div>
                    {content && (
                        <p className="text-[11px] text-white/70 leading-relaxed">{content}</p>
                    )}
                    {subContent && (
                        <p className="text-[10px] text-white/45 mt-0.5 italic">{subContent}</p>
                    )}
                </div>
            </div>
            {connector && connectorLabel && (
                <div className="flex items-center gap-1.5 pl-6 py-0.5">
                    <span className="text-[9px] text-white/25 italic">↓ {connectorLabel}</span>
                </div>
            )}
        </div>
    );
}

function DebateFlowChains({
    trace,
    round1,
    agents,
}: {
    trace: DebateTrace;
    round1?: RoundDTO;
    agents: string[];
}) {
    // Build a lookup of initial position summaries by agent name
    const initialSummaries: Record<string, string> = {};
    if (round1) {
        for (const msg of round1.messages) {
            if (!msg.agent_role) continue;
            const payload = (msg.payload ?? {}) as Record<string, unknown>;
            const summary = String(
                payload.main_argument ?? payload.short_summary ?? payload.stance ?? msg.text ?? ""
            ).slice(0, 200);
            if (summary) initialSummaries[msg.agent_role] = summary;
        }
    }

    return (
        <section>
            <div className="flex items-center gap-2 mb-3">
                <span className="text-base">⛓</span>
                <h3 className="text-sm font-semibold text-white/90 tracking-wide uppercase">Argument Chains</h3>
                <span className="ml-auto text-[10px] text-white/30">
                    {trace.critiques.length} chain{trace.critiques.length !== 1 ? "s" : ""}
                </span>
            </div>
            <p className="text-[11px] text-white/40 mb-3 leading-relaxed">
                Each chain shows the complete debate exchange: the original claim, who challenged it, how the agent responded, and whether the position changed.
            </p>
            <div className="space-y-2">
                {trace.critiques.map((c) => {
                    const response = trace.critique_responses.find(
                        (r) => r.agent_id === c.to_agent_id || r.agent_name === c.to_agent_name,
                    );
                    const revision = trace.revised_positions.find(
                        (r) => r.agent_id === c.to_agent_id || r.agent_name === c.to_agent_name,
                    );
                    return (
                        <ArgumentChainCard
                            key={c.id}
                            critique={c}
                            response={response}
                            revision={revision}
                            initialSummary={initialSummaries[c.to_agent_name]}
                            agents={agents}
                        />
                    );
                })}
            </div>
        </section>
    );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function DebateHistoryPanel() {
    const session = useDebateStore((s) => s.session);
    const turn = session?.latest_turn ?? null;

    if (!turn) {
        return <EmptySection message="No debate data available." />;
    }

    const agents = (session?.agents ?? []).map((a) => a.role);
    const trace = turn.debate_trace;
    const rounds = turn.rounds ?? [];

    const round1 = rounds.find((r) => r.round_type === "initial");
    const round2 = rounds.find((r) => r.round_type === "critique" && (r.cycle_number ?? 1) === 1);
    const round3 = rounds.find((r) => r.round_type === "critique_response");
    const round4 = rounds.find((r) => r.round_type === "revised_position");
    const round5 = rounds.find((r) => r.round_type === "final" && (r.cycle_number ?? 1) === 1);

    const hasCritiqueTrace = trace && trace.critiques.length > 0;
    const hasCritiqueResponseTrace = trace && trace.critique_responses.length > 0;
    const hasRevisedTrace = trace && trace.revised_positions.length > 0;

    return (
        <div className="space-y-8 px-1 pb-8">
            {/* ── Argument Chains (top) ─────────────────────────────────────── */}
            {hasCritiqueTrace && (
                <DebateFlowChains
                    trace={trace!}
                    round1={round1}
                    agents={agents}
                />
            )}

            {/* ── Divider ─────────────────────────────────────────────────── */}
            {hasCritiqueTrace && (
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[10px] text-white/25 uppercase tracking-widest">Detailed Trace</span>
                    <div className="flex-1 h-px bg-white/10" />
                </div>
            )}

            {/* ── Phase 1 · Stage 1: Initial Positions ─────────────────────── */}
            <section>
                <SectionHeader title="Phase 1 · Stage 1 — Initial Positions" count={round1?.messages.filter((m) => m.agent_id).length ?? 0} icon="💬" />
                {round1 ? (
                    <div className="space-y-2">
                        {round1.messages
                            .filter((m) => m.agent_id)
                            .map((msg) => (
                                <InitialPositionItem key={msg.id} msg={msg} agents={agents} />
                            ))}
                    </div>
                ) : (
                    <EmptySection message="Initial positions not available." />
                )}
            </section>

            {/* ── Phase 2 · Stage 2: Cross-Critiques ──────────────────────────── */}
            <section>
                <SectionHeader
                    title="Phase 2 · Stage 2 — Cross-Critiques"
                    count={hasCritiqueTrace ? trace.critiques.length : round2?.messages.filter((m) => m.agent_id).length ?? 0}
                    icon="⚔️"
                />
                {hasCritiqueTrace ? (
                    <div className="space-y-2">
                        {trace.critiques.map((c) => (
                            <CritiqueItem key={c.id} c={c} agents={agents} />
                        ))}
                    </div>
                ) : round2 ? (
                    <div className="space-y-2">
                        {round2.messages
                            .filter((m) => m.agent_id)
                            .map((msg) => (
                                <CritiqueItemFromMessage key={msg.id} msg={msg} agents={agents} />
                            ))}
                    </div>
                ) : (
                    <EmptySection message="Critique round not available." />
                )}
            </section>

            {/* ── Phase 2 · Stage 3: Responses to Critiques ──────────────────── */}
            <section>
                <SectionHeader
                    title="Phase 2 · Stage 3 — Responses to Critiques"
                    count={hasCritiqueResponseTrace ? trace.critique_responses.length : round3?.messages.filter((m) => m.agent_id).length ?? 0}
                    icon="💬"
                />
                {hasCritiqueResponseTrace ? (
                    <div className="space-y-2">
                        {trace.critique_responses.map((r) => (
                            <CritiqueResponseItem key={r.id} r={r} agents={agents} />
                        ))}
                    </div>
                ) : round3 ? (
                    <div className="space-y-2">
                        {round3.messages
                            .filter((m) => m.agent_id)
                            .map((msg) => (
                                <CritiqueResponseFromMessage key={msg.id} msg={msg} agents={agents} />
                            ))}
                    </div>
                ) : (
                    <IncompleteStageWarning stage="Critique Responses (Stage 3)" />
                )}
            </section>

            {/* ── Phase 2 · Stage 4: Revised Positions ────────────────────────── */}
            <section>
                <SectionHeader
                    title="Phase 2 · Stage 4 — Revised Positions"
                    count={hasRevisedTrace ? trace.revised_positions.length : round4?.messages.filter((m) => m.agent_id).length ?? 0}
                    icon="🔄"
                />
                {hasRevisedTrace ? (
                    <div className="space-y-2">
                        {trace.revised_positions.map((r) => (
                            <RevisedPositionItem key={r.id} r={r} agents={agents} />
                        ))}
                    </div>
                ) : round4 ? (
                    <div className="space-y-2">
                        {round4.messages
                            .filter((m) => m.agent_id)
                            .map((msg) => (
                                <RevisedPositionFromMessage key={msg.id} msg={msg} agents={agents} />
                            ))}
                    </div>
                ) : (
                    <IncompleteStageWarning stage="Revised Positions (Stage 4)" />
                )}
            </section>

            {/* ── Phase 3 · Stage 5: Final Decision ───────────────────────────── */}
            <section>
                <SectionHeader title="Phase 3 · Stage 5 — Moderator Verdict" count={round5 ? 1 : 0} icon="✨" />
                {round5 ? (
                    <FinalSynthesisSection round={round5} />
                ) : (
                    <EmptySection message="Final synthesis not available." />
                )}
            </section>

            {/* ── Debate Impact ────────────────────────────────────────────────── */}
            {trace?.debate_impact && (
                <section>
                    <SectionHeader title="Debate Impact" count={trace.debate_impact.important_changes.length} icon="📊" />
                    <div className="p-4 rounded-lg bg-violet-500/8 border border-violet-500/20 space-y-3">
                        {trace.debate_impact.how_debate_improved_answer && (
                            <p className="text-sm text-white/80">
                                {trace.debate_impact.how_debate_improved_answer}
                            </p>
                        )}
                        {trace.debate_impact.major_disagreements.length > 0 && (
                            <div>
                                <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">
                                    Major disagreements
                                </p>
                                <ul className="space-y-1">
                                    {trace.debate_impact.major_disagreements.map((d, i) => (
                                        <li key={i} className="text-xs text-white/60 flex gap-2">
                                            <span className="text-rose-400 shrink-0">•</span>
                                            <span>{d}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {trace.debate_impact.single_llm_risk_avoided && (
                            <p className="text-xs text-emerald-400/70 italic">
                                {trace.debate_impact.single_llm_risk_avoided}
                            </p>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}
