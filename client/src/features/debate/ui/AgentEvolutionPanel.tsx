/**
 * AgentEvolutionPanel — Per-agent before/after view. ("Changes" tab)
 *
 * For each agent shows:
 *   - Initial position (Phase 1 · Stage 1)
 *   - Critiques received (Phase 2 · Stage 2)
 *   - Their response to critiques (Phase 2 · Stage 3)
 *   - Revised position (Phase 2 · Stage 4)
 *   - Change type and reason
 *
 * This directly answers: "Did the debate actually affect the agents' opinions?"
 */
import { useMemo } from "react";
import { useDebateStore } from "../model/debate.store";
import type {
    AgentDTO,
    CritiqueTraceItem,
    CritiqueResponseTraceItem,
    RevisedPositionTraceItem,
    MessageDTO,
} from "../api/debate.types";
import { cn } from "@/shared/lib/cn";

// ── Color palette ─────────────────────────────────────────────────────────────
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
const AGENT_BADGE_COLORS = [
    "bg-indigo-500/20 text-indigo-200",
    "bg-emerald-500/20 text-emerald-200",
    "bg-amber-500/20 text-amber-200",
    "bg-rose-500/20 text-rose-200",
    "bg-sky-500/20 text-sky-200",
];

type ChangeTypeBadgeProps = { changeType: string; changed: boolean };
function ChangeTypeBadge({ changeType, changed }: ChangeTypeBadgeProps) {
    if (!changed) {
        return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                Unchanged
            </span>
        );
    }
    // User-facing labels (professor-friendly)
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

// ── Single agent evolution card ───────────────────────────────────────────────

interface AgentEvolutionData {
    agent: AgentDTO;
    agentIndex: number;
    initialPosition: string;
    initialKeyPoints: string[];
    critiquesReceived: CritiqueTraceItem[];
    critiqueResponse: CritiqueResponseTraceItem | null;
    revisedPosition: RevisedPositionTraceItem | null;
    // Fallback from raw messages when trace not available
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
            {/* Header */}
            <div className={cn("px-4 py-3 bg-gradient-to-r border-b", AGENT_HEADER_COLORS[idx])}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={cn("px-2 py-0.5 rounded text-xs font-semibold", AGENT_BADGE_COLORS[idx])}>
                                {agent.role}
                            </span>
                            <span className="text-[10px] text-white/40">{agent.model}</span>
                        </div>
                    </div>
                    {revisedPosition && (
                        <ChangeTypeBadge changeType={changeType} changed={changed} />
                    )}
                </div>
            </div>

            <div className="px-4 py-4 space-y-4">
                {/* Initial position */}
                {initialText && (
                    <div>
                        <p className={cn("text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-2")}>
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

                {/* Critiques received */}
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

                {/* Response to critiques */}
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

                {/* Revised position */}
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

                {/* No revised position fallback */}
                {!revisedText && !revisedPosition && (
                    <div className="py-3 text-center text-xs text-white/30 italic">
                        Revised position not available (older debate pipeline).
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function AgentEvolutionPanel() {
    const session = useDebateStore((s) => s.session);
    const turn = session?.latest_turn ?? null;
    const agents = session?.agents ?? [];

    const evolutionData = useMemo<AgentEvolutionData[]>(() => {
        if (!turn || !agents.length) return [];

        const trace = turn.debate_trace;
        const rounds = turn.rounds ?? [];

        const round1 = rounds.find((r) => r.round_type === "initial");
        const round3 = rounds.find((r) => r.round_type === "critique_response");
        const round4 = rounds.find((r) => r.round_type === "revised_position");

        return agents.map((agent, agentIndex) => {
            // Round 1 message for this agent
            const initialMsg =
                round1?.messages.find((m) => m.agent_id === agent.id) ?? null;
            const initialPayload = (initialMsg?.payload ?? {}) as Record<string, unknown>;
            const initialPosition = String(
                initialPayload.main_argument ??
                initialPayload.short_summary ??
                initialPayload.stance ??
                ""
            );
            const initialKeyPoints = Array.isArray(initialPayload.key_points)
                ? (initialPayload.key_points as string[]).slice(0, 4)
                : [];

            // Critiques received (from trace or fallback from round 2)
            const critiquesReceived: CritiqueTraceItem[] =
                trace?.critiques.filter((c) => c.to_agent_id === agent.id || c.to_agent_name === agent.role) ?? [];

            // Critique response
            const critiqueResponse: CritiqueResponseTraceItem | null =
                trace?.critique_responses.find(
                    (r) => r.agent_id === agent.id || r.agent_name === agent.role
                ) ?? null;
            const critiqueResponseMsg =
                round3?.messages.find((m) => m.agent_id === agent.id) ?? null;

            // Revised position
            const revisedPosition: RevisedPositionTraceItem | null =
                trace?.revised_positions.find(
                    (r) => r.agent_id === agent.id || r.agent_name === agent.role
                ) ?? null;
            const revisedPositionMsg =
                round4?.messages.find((m) => m.agent_id === agent.id) ?? null;

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

    if (!turn || !agents.length) {
        return (
            <div className="py-8 text-center text-xs text-white/30 italic">
                No debate data available.
            </div>
        );
    }

    const changedCount = evolutionData.filter((d) => d.revisedPosition?.changed || d.revisedPositionMsg).length;

    return (
        <div className="space-y-4 pb-8">
            {/* Professor-friendly explanation */}
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">🔄</span>
                    <h3 className="text-[12px] font-semibold text-sky-200">Position Changes</h3>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                    This panel shows how each agent's answer evolved after being challenged. Compare the initial position with the revised one to see the debate's impact.
                </p>
            </div>

            {/* Summary header */}
            <div className="px-1 py-1 flex items-center gap-3 text-xs text-white/50">
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

            {/* Agent cards */}
            <div className="space-y-4">
                {evolutionData.map((data) => (
                    <AgentEvolutionCard key={data.agent.id} data={data} />
                ))}
            </div>
        </div>
    );
}
