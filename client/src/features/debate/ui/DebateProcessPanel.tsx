/**
 * DebateProcessPanel — Unified "Debate Process" tab.
 *
 * Replaces the old "Debate Flow" + "Changes" tabs with one panel.
 *
 * Section A — Argument Exchange
 *   Visual chains:  Initial Claim → Critique → Response → Revised Position
 *   Below chains:   Stage-by-stage chronological detail (Phase 1·Stage 1 … Phase 3·Stage 5)
 *
 * Section B — Position Evolution
 *   Per-agent before/after: Initial → Critiques Received → Response → Revised
 *   Professor-friendly change labels (Unchanged / Partially changed / Strengthened / Changed)
 *
 * This tab directly answers the professor's question:
 * "Where can I see that agents actually debated?"
 */
import { useState, useMemo } from "react";
import { useDebateStore } from "../model/debate.store";
import type {
    CritiqueTraceItem,
    CritiqueResponseTraceItem,
    RevisedPositionTraceItem,
    DebateTrace,
    MessageDTO,
    RoundDTO,
    AgentDTO,
    TurnDTO,
} from "../api/debate.types";
import { cn } from "@/shared/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Color palettes (shared across both sections)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_COLORS = [
    "border-l-indigo-400 bg-indigo-500/5",
    "border-l-emerald-400 bg-emerald-500/5",
    "border-l-amber-400 bg-amber-500/5",
    "border-l-rose-400 bg-rose-500/5",
    "border-l-sky-400 bg-sky-500/5",
];
const AGENT_BADGE_COLORS_BORDER = [
    "bg-indigo-500/20 text-indigo-200 border-indigo-500/30",
    "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    "bg-amber-500/20 text-amber-200 border-amber-500/30",
    "bg-rose-500/20 text-rose-200 border-rose-500/30",
    "bg-sky-500/20 text-sky-200 border-sky-500/30",
];
const AGENT_BORDER_COLORS = [
    "border-indigo-500/40",
    "border-emerald-500/40",
    "border-amber-500/40",
    "border-rose-500/40",
    "border-sky-500/40",
];
const AGENT_HEADER_COLORS = [
    "from-indigo-500/15 to-transparent border-b-indigo-500/20",
    "from-emerald-500/15 to-transparent border-b-emerald-500/20",
    "from-amber-500/15 to-transparent border-b-amber-500/20",
    "from-rose-500/15 to-transparent border-b-rose-500/20",
    "from-sky-500/15 to-transparent border-b-sky-500/20",
];
const AGENT_BADGE_COLORS_PLAIN = [
    "bg-indigo-500/20 text-indigo-200",
    "bg-emerald-500/20 text-emerald-200",
    "bg-amber-500/20 text-amber-200",
    "bg-rose-500/20 text-rose-200",
    "bg-sky-500/20 text-sky-200",
];

function agentColorIndex(name: string, agents: string[]): number {
    const idx = agents.indexOf(name);
    return idx >= 0 ? idx % AGENT_COLORS.length : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Switcher pill
// ─────────────────────────────────────────────────────────────────────────────

type Section = "exchange" | "evolution";

function SectionSwitcher({
    active,
    onChange,
    exchangeCount,
    agentCount,
}: {
    active: Section;
    onChange: (s: Section) => void;
    exchangeCount: number;
    agentCount: number;
}) {
    return (
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10 shrink-0">
            <button
                type="button"
                onClick={() => onChange("exchange")}
                className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                    active === "exchange"
                        ? "bg-rose-500/20 text-rose-200 border border-rose-500/30"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5",
                )}
            >
                <span>⚔️</span>
                Argument Exchange
                {exchangeCount > 0 && (
                    <span className="text-[9px] opacity-70">({exchangeCount})</span>
                )}
            </button>
            <button
                type="button"
                onClick={() => onChange("evolution")}
                className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                    active === "evolution"
                        ? "bg-sky-500/20 text-sky-200 border border-sky-500/30"
                        : "text-white/40 hover:text-white/70 hover:bg-white/5",
                )}
            >
                <span>🔄</span>
                Position Evolution
                {agentCount > 0 && (
                    <span className="text-[9px] opacity-70">({agentCount})</span>
                )}
            </button>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A: Argument Exchange
// ─────────────────────────────────────────────────────────────────────────────

type ChangeDisplay = "Changed" | "Partially changed" | "Strengthened" | "Unchanged" | "Unclear";

const CHANGE_TYPE_LABEL: Record<string, ChangeDisplay> = {
    narrowed_position: "Partially changed",
    expanded_position: "Strengthened",
    changed_stance: "Changed",
    added_condition: "Strengthened",
    resolved_uncertainty: "Strengthened",
    other: "Changed",
};

function AgentBadge({ name, agents }: { name: string; agents: string[] }) {
    const idx = agentColorIndex(name, agents);
    return (
        <span className={cn("px-2 py-0.5 rounded text-[11px] font-semibold border", AGENT_BADGE_COLORS_BORDER[idx])}>
            {name}
        </span>
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
        : changeLabel === "Unclear" ? "bg-white/10 text-white/40 border-white/20"
        : "bg-amber-500/15 text-amber-300 border-amber-500/30";

    const criticIdx = agents.indexOf(critique.from_agent_name);
    const targetIdx = agents.indexOf(critique.to_agent_name);
    const criticColor = ["text-indigo-300","text-emerald-300","text-amber-300","text-rose-300","text-sky-300"][Math.max(0, criticIdx) % 5];
    const targetColor = ["text-indigo-300","text-emerald-300","text-amber-300","text-rose-300","text-sky-300"][Math.max(0, targetIdx) % 5];
    const criticBg = ["bg-indigo-500/15 border-indigo-500/30","bg-emerald-500/15 border-emerald-500/30","bg-amber-500/15 border-amber-500/30","bg-rose-500/15 border-rose-500/30","bg-sky-500/15 border-sky-500/30"][Math.max(0, criticIdx) % 5];
    const targetBg = ["bg-indigo-500/15 border-indigo-500/30","bg-emerald-500/15 border-emerald-500/30","bg-amber-500/15 border-amber-500/30","bg-rose-500/15 border-rose-500/30","bg-sky-500/15 border-sky-500/30"][Math.max(0, targetIdx) % 5];

    return (
        <div className="rounded-xl border border-white/10 bg-white/3 overflow-hidden">
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

            {expanded && (
                <div className="px-3 pb-3 border-t border-white/10 pt-2 space-y-0">
                    {initialSummary && (
                        <ChainStep
                            stepIcon="💬"
                            stepLabel={`Initial position — ${critique.to_agent_name}`}
                            content={initialSummary}
                            connector
                            connectorLabel="challenged by"
                        />
                    )}
                    <ChainStep
                        stepIcon="⚔️"
                        stepLabel={`Critique by ${critique.from_agent_name}`}
                        content={critique.critique_summary}
                        subContent={critique.weakness_found ? `Weakness: ${critique.weakness_found}` : undefined}
                        connector={!!response}
                        connectorLabel="responded"
                        colorClass="text-rose-300"
                    />
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

function ArgumentExchangeSection({
    trace,
    round1,
    agents,
}: {
    trace: DebateTrace;
    round1?: RoundDTO;
    agents: string[];
}) {
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

    if (trace.critiques.length === 0) {
        return (
            <div className="py-10 text-center text-xs text-white/30 italic">
                No argument exchanges found in this debate.<br />
                This may be an older debate without the 5-stage pipeline.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Intro */}
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">⛓</span>
                    <h3 className="text-[12px] font-semibold text-rose-200">Argument Chains</h3>
                    <span className="ml-auto text-[10px] text-white/30">
                        {trace.critiques.length} chain{trace.critiques.length !== 1 ? "s" : ""}
                    </span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                    Each chain shows the full debate exchange: the original claim, who challenged it, how the agent responded, and whether their position changed.
                </p>
            </div>

            {/* Chains */}
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

            {/* Stage-by-stage detail divider */}
            <div className="pt-3">
                <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[10px] text-white/30 uppercase tracking-wider">Chronological Detail</span>
                    <div className="flex-1 h-px bg-white/10" />
                </div>
                <StageDetailView trace={trace} round1={round1} agents={agents} />
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage detail (chronological) — condensed from DebateHistoryPanel's main view
// ─────────────────────────────────────────────────────────────────────────────

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

function StageDetailView({
    trace,
    round1,
    agents,
}: {
    trace: DebateTrace | null;
    round1?: RoundDTO;
    agents: string[];
}) {
    if (!trace && !round1) return null;

    return (
        <div className="space-y-4">
            {/* Stage 2: Cross-Critiques */}
            {(trace?.critiques?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[10px] font-semibold text-rose-400/70 uppercase tracking-wide mb-2">
                        Phase 2 · Stage 2 — Cross-Critiques
                    </p>
                    <div className="space-y-2">
                        {trace!.critiques.map((c) => (
                            <ExpandableCard
                                key={c.id}
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
                                            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wide mb-1">Full critique</p>
                                            <p className="text-xs text-white/80 leading-relaxed">{c.critique_summary}</p>
                                        </div>
                                    )}
                                </div>
                            </ExpandableCard>
                        ))}
                    </div>
                </div>
            )}

            {/* Stage 3: Responses */}
            {(trace?.critique_responses?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[10px] font-semibold text-sky-400/70 uppercase tracking-wide mb-2">
                        Phase 2 · Stage 3 — Responses to Critiques
                    </p>
                    <div className="space-y-2">
                        {trace!.critique_responses.map((r) => (
                            <ExpandableCard
                                key={r.agent_id}
                                summary={
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <AgentBadge name={r.agent_name} agents={agents} />
                                            <span className={cn("text-[11px] font-medium", {
                                                unchanged: "text-slate-400",
                                                slightly_revised: "text-amber-400",
                                                significantly_revised: "text-orange-400",
                                                reversed: "text-rose-400",
                                            }[r.stance_update ?? "unchanged"] ?? "text-white/40")}>
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
                                            <p className="text-xs text-white/80 leading-relaxed">{r.response}</p>
                                        </div>
                                    )}
                                    {r.accepted_points.length > 0 && (
                                        <div>
                                            <p className="text-[11px] font-semibold text-emerald-400/70 uppercase tracking-wide mb-1">✓ Accepted</p>
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
                                            <p className="text-[11px] font-semibold text-rose-400/70 uppercase tracking-wide mb-1">✗ Rejected</p>
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
                                </div>
                            </ExpandableCard>
                        ))}
                    </div>
                </div>
            )}

            {/* Stage 4: Revised positions */}
            {(trace?.revised_positions?.length ?? 0) > 0 && (
                <div>
                    <p className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wide mb-2">
                        Phase 2 · Stage 4 — Revised Positions
                    </p>
                    <div className="space-y-2">
                        {trace!.revised_positions.map((r) => {
                            const idx = agentColorIndex(r.agent_name, agents);
                            const changeColor = r.changed ? "text-amber-300" : "text-emerald-400";
                            return (
                                <ExpandableCard
                                    key={r.agent_id}
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
                                        <div className="grid grid-cols-1 gap-3">
                                            {r.initial_position_summary && (
                                                <div>
                                                    <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-1">Before</p>
                                                    <p className="text-xs text-white/60 leading-relaxed">{r.initial_position_summary}</p>
                                                </div>
                                            )}
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
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B: Position Evolution (from AgentEvolutionPanel)
// ─────────────────────────────────────────────────────────────────────────────

function ChangeTypeBadge({ changeType, changed }: { changeType: string; changed: boolean }) {
    if (!changed) {
        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                Unchanged
            </span>
        );
    }
    const labelMap: Record<string, string> = {
        narrowed_position: "Partially changed",
        expanded_position: "Strengthened",
        changed_stance: "Changed",
        added_condition: "Strengthened",
        resolved_uncertainty: "Clarified",
        other: "Revised",
    };
    const label = labelMap[changeType] ?? changeType?.replace(/_/g, " ") ?? "Changed";
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
            {label}
        </span>
    );
}

interface AgentEvolutionData {
    agent: AgentDTO;
    agentIndex: number;
    initialPosition: string;
    initialKeyPoints: string[];
    critiquesReceived: CritiqueTraceItem[];
    critiqueResponse: CritiqueResponseTraceItem | null;
    revisedPosition: RevisedPositionTraceItem | null;
    initialMsg: MessageDTO | null;
    critiqueResponseMsg: MessageDTO | null;
    revisedPositionMsg: MessageDTO | null;
}

function AgentEvolutionCard({ data }: { data: AgentEvolutionData }) {
    const { agent, agentIndex, initialPosition, initialKeyPoints, critiquesReceived, critiqueResponse, revisedPosition } = data;
    const idx = agentIndex % AGENT_BORDER_COLORS.length;

    const changed = revisedPosition?.changed ?? false;
    const changeType = revisedPosition?.change_type ?? "";
    const revisedText =
        revisedPosition?.revised_position ||
        (data.revisedPositionMsg
            ? String((data.revisedPositionMsg.payload as Record<string, unknown>)?.revised_position ?? (data.revisedPositionMsg.payload as Record<string, unknown>)?.response ?? data.revisedPositionMsg.text ?? "")
            : "");
    const initialText =
        initialPosition ||
        (data.initialMsg
            ? String((data.initialMsg.payload as Record<string, unknown>)?.response ?? (data.initialMsg.payload as Record<string, unknown>)?.main_argument ?? data.initialMsg.text ?? "")
            : "");

    return (
        <div className={cn("rounded-xl border overflow-hidden", AGENT_BORDER_COLORS[idx])}>
            <div className={cn("px-4 py-3 bg-gradient-to-r border-b", AGENT_HEADER_COLORS[idx])}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", AGENT_BADGE_COLORS_PLAIN[idx])}>
                            {agent.role}
                        </span>
                        <span className="text-[10px] text-white/40">{agent.model}</span>
                    </div>
                    {revisedPosition && (
                        <ChangeTypeBadge changeType={changeType} changed={changed} />
                    )}
                </div>
            </div>

            <div className="px-4 py-4 space-y-4">
                {initialText && (
                    <div>
                        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-2">
                            Phase 1 · Stage 1 — Initial Position
                        </p>
                        <p className="text-xs text-white/65 leading-relaxed line-clamp-5">{initialText}</p>
                        {initialKeyPoints.length > 0 && (
                            <ul className="mt-2 space-y-1">
                                {initialKeyPoints.slice(0, 3).map((pt, i) => (
                                    <li key={i} className="text-[11px] text-white/50 flex gap-1.5">
                                        <span className="text-white/30 shrink-0">•</span>
                                        <span>{pt}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {critiquesReceived.length > 0 && (
                    <div>
                        <p className="text-[11px] font-semibold text-rose-400/60 uppercase tracking-wide mb-2">
                            Phase 2 · Stage 2 — Critiques Received
                        </p>
                        <div className="space-y-2">
                            {critiquesReceived.map((c) => (
                                <div key={c.id} className="pl-3 border-l border-rose-500/30 space-y-1">
                                    <p className="text-[11px] font-medium text-white/50">
                                        From <span className="text-white/70">{c.from_agent_name}</span>
                                    </p>
                                    {c.target_claim && (
                                        <p className="text-xs text-amber-300/70 italic">"{c.target_claim}"</p>
                                    )}
                                    {c.critique_summary && (
                                        <p className="text-xs text-white/60">{c.critique_summary}</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {(critiqueResponse || data.critiqueResponseMsg) && (
                    <div>
                        <p className="text-[11px] font-semibold text-sky-400/60 uppercase tracking-wide mb-2">
                            Phase 2 · Stage 3 — Response to Critique
                        </p>
                        {critiqueResponse ? (
                            <div className="space-y-2">
                                {critiqueResponse.accepted_points.length > 0 && (
                                    <div>
                                        <p className="text-[11px] text-emerald-400/70 mb-1">Accepted:</p>
                                        <ul className="space-y-0.5">
                                            {critiqueResponse.accepted_points.map((pt, i) => (
                                                <li key={i} className="text-xs text-white/60 flex gap-1.5">
                                                    <span className="text-emerald-400 shrink-0">✓</span>
                                                    <span>{pt}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {critiqueResponse.rejected_points.length > 0 && (
                                    <div>
                                        <p className="text-[11px] text-rose-400/70 mb-1">Rejected:</p>
                                        <ul className="space-y-0.5">
                                            {critiqueResponse.rejected_points.map((pt, i) => (
                                                <li key={i} className="text-xs text-white/60 flex gap-1.5">
                                                    <span className="text-rose-400 shrink-0">✗</span>
                                                    <span>{pt}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {critiqueResponse.planned_revision && (
                                    <p className="text-xs text-indigo-300/70 italic">
                                        Planned revision: {critiqueResponse.planned_revision}
                                    </p>
                                )}
                            </div>
                        ) : data.critiqueResponseMsg ? (
                            <p className="text-xs text-white/60 line-clamp-4">
                                {String((data.critiqueResponseMsg.payload as Record<string, unknown>)?.response ?? data.critiqueResponseMsg.text ?? "")}
                            </p>
                        ) : null}
                    </div>
                )}

                {revisedText && (
                    <div className={cn("p-3 rounded-lg border", changed ? "bg-amber-500/5 border-amber-500/20" : "bg-emerald-500/5 border-emerald-500/20")}>
                        <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide mb-2">
                            Phase 2 · Stage 4 — Revised Position
                        </p>
                        <p className="text-xs text-white/80 leading-relaxed">{revisedText}</p>
                        {revisedPosition?.reason_for_change && (
                            <p className="mt-2 text-[11px] text-white/50 italic">
                                Why: {revisedPosition.reason_for_change}
                            </p>
                        )}
                    </div>
                )}

                {!revisedText && !revisedPosition && (
                    <div className="py-3 text-center text-xs text-white/30 italic">
                        Revised position not available (older debate pipeline).
                    </div>
                )}
            </div>
        </div>
    );
}

function PositionEvolutionSection({
    turn,
    agents,
}: {
    turn: TurnDTO;
    agents: AgentDTO[];
}) {
    // Inline useMemo via the parent — we pass already computed data

    const evolutionData = useMemo<AgentEvolutionData[]>(() => {
        if (!turn || !agents.length) return [];
        const trace = turn.debate_trace;
        const rounds = turn.rounds ?? [];
        const round1 = rounds.find((r: RoundDTO) => r.round_type === "initial");
        const round3 = rounds.find((r: RoundDTO) => r.round_type === "critique_response");
        const round4 = rounds.find((r: RoundDTO) => r.round_type === "revised_position");

        return agents.map((agent, agentIndex) => {
            const initialMsg = round1?.messages.find((m: MessageDTO) => m.agent_id === agent.id) ?? null;
            const initialPayload = (initialMsg?.payload ?? {}) as Record<string, unknown>;
            const initialPosition = String(
                initialPayload.main_argument ?? initialPayload.short_summary ?? initialPayload.stance ?? ""
            );
            const initialKeyPoints = Array.isArray(initialPayload.key_points)
                ? (initialPayload.key_points as string[]).slice(0, 4)
                : [];

            const critiquesReceived: CritiqueTraceItem[] =
                trace?.critiques.filter((c: CritiqueTraceItem) => c.to_agent_id === agent.id || c.to_agent_name === agent.role) ?? [];

            const critiqueResponse: CritiqueResponseTraceItem | null =
                trace?.critique_responses.find(
                    (r: CritiqueResponseTraceItem) => r.agent_id === agent.id || r.agent_name === agent.role
                ) ?? null;
            const critiqueResponseMsg = round3?.messages.find((m: MessageDTO) => m.agent_id === agent.id) ?? null;

            const revisedPosition: RevisedPositionTraceItem | null =
                trace?.revised_positions.find(
                    (r: RevisedPositionTraceItem) => r.agent_id === agent.id || r.agent_name === agent.role
                ) ?? null;
            const revisedPositionMsg = round4?.messages.find((m: MessageDTO) => m.agent_id === agent.id) ?? null;

            return {
                agent,
                agentIndex,
                initialPosition,
                initialKeyPoints,
                critiquesReceived,
                critiqueResponse,
                revisedPosition,
                initialMsg,
                critiqueResponseMsg,
                revisedPositionMsg,
            };
        });
    }, [turn, agents]);

    if (!agents.length) {
        return (
            <div className="py-10 text-center text-xs text-white/30 italic">
                No agent data available.
            </div>
        );
    }

    const changedCount = evolutionData.filter((d) => d.revisedPosition?.changed || d.revisedPositionMsg).length;

    return (
        <div className="space-y-4 pb-4">
            {/* Explanation */}
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">🔄</span>
                    <h3 className="text-[12px] font-semibold text-sky-200">Position Changes</h3>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                    Compare each agent's initial position with their revised one to see the debate's impact.
                </p>
            </div>

            {/* Summary */}
            <div className="px-1 flex items-center gap-3 text-xs text-white/50">
                <span className="font-semibold text-white/70">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
                {changedCount > 0 && (
                    <>
                        <span>·</span>
                        <span className="text-amber-300">{changedCount} revised their position</span>
                    </>
                )}
                {evolutionData.some((d) => d.revisedPosition && !d.revisedPosition.changed) && (
                    <>
                        <span>·</span>
                        <span className="text-emerald-300">
                            {evolutionData.filter((d) => d.revisedPosition && !d.revisedPosition.changed).length} held their position
                        </span>
                    </>
                )}
            </div>

            {/* Cards */}
            <div className="space-y-4">
                {evolutionData.map((data) => (
                    <AgentEvolutionCard key={data.agent.id} data={data} />
                ))}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export default function DebateProcessPanel() {
    const session = useDebateStore((s) => s.session);
    const turn = session?.latest_turn ?? null;
    const agents = session?.agents ?? [];
    const [activeSection, setActiveSection] = useState<Section>("exchange");

    const agentNames = useMemo(() => agents.map((a) => a.role), [agents]);
    const trace = turn?.debate_trace ?? null;
    const rounds = turn?.rounds ?? [];
    const round1 = rounds.find((r) => r.round_type === "initial");

    if (!turn) {
        return (
            <div className="py-12 text-center text-xs text-white/30 italic">
                Debate data will appear here once the debate completes.
            </div>
        );
    }

    return (
        <div className="space-y-4 pb-6">
            {/* Section switcher */}
            <SectionSwitcher
                active={activeSection}
                onChange={setActiveSection}
                exchangeCount={trace?.critiques.length ?? 0}
                agentCount={agents.length}
            />

            {/* Section A: Argument Exchange */}
            {activeSection === "exchange" && (
                <ArgumentExchangeSection
                    trace={trace ?? { critiques: [], critique_responses: [], revised_positions: [], debate_impact: null }}
                    round1={round1}
                    agents={agentNames}
                />
            )}

            {/* Section B: Position Evolution */}
            {activeSection === "evolution" && (
                <PositionEvolutionSection
                    turn={turn}
                    agents={agents}
                />
            )}
        </div>
    );
}
