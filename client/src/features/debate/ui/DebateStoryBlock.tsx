/**
 * DebateStoryBlock — narrative summary of the debate above the detailed trace.
 *
 * Shows:
 *  - Main disagreement (from debate_trace.debate_impact.major_disagreements)
 *  - Most important critique
 *  - Most important position change
 *  - Final debate outcome
 *  - How the debate improved the answer
 */
import { cn } from "@/shared/lib/cn";
import type { TurnDTO } from "../api/debate.types";

interface DebateStoryBlockProps {
    turn: TurnDTO;
}

export default function DebateStoryBlock({ turn }: DebateStoryBlockProps) {
    const trace = turn.debate_trace;
    const impact = trace?.debate_impact;

    // Final answer
    const finalSummary = turn.final_summary;

    // Main disagreement
    const mainDisagreement = impact?.major_disagreements?.[0] ?? null;

    // Most important critique
    const topCritique = trace?.critiques?.[0] ?? null;

    // Most important position change
    const topChange = trace?.revised_positions?.find((r) => r.changed) ?? null;

    // How debate improved the answer
    const improvement = impact?.how_debate_improved_answer ?? null;

    const hasStory = mainDisagreement || topCritique || topChange || improvement;

    if (!hasStory && !finalSummary) return null;

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                <span className="text-base">📖</span>
                <h3 className="text-[13px] font-semibold text-white/90">Debate Story</h3>
                <span className="text-[10px] text-white/40 ml-auto">What happened in this debate</span>
            </div>

            {/* Story cards */}
            <div className="space-y-2">
                {mainDisagreement && (
                    <StoryCard
                        icon="⚡"
                        label="Main Disagreement"
                        color="amber"
                        content={mainDisagreement}
                    />
                )}

                {topCritique && (
                    <StoryCard
                        icon="🎯"
                        label={`Key Critique: ${topCritique.from_agent_name} → ${topCritique.to_agent_name}`}
                        color="rose"
                        content={topCritique.critique_summary}
                        badge={topCritique.severity ? `Severity: ${topCritique.severity}` : undefined}
                    />
                )}

                {topChange && (
                    <StoryCard
                        icon="🔄"
                        label={`Position Change: ${topChange.agent_name}`}
                        color="indigo"
                        content={topChange.change_summary}
                        badge={topChange.change_type?.replace(/_/g, " ")}
                    />
                )}

                {!topChange && trace?.revised_positions && trace.revised_positions.length > 0 && (
                    <StoryCard
                        icon="🛡️"
                        label="Positions Held"
                        color="emerald"
                        content={`${trace.revised_positions.filter((r) => !r.changed).length} agent(s) maintained their positions after critiques.`}
                    />
                )}

                {improvement && (
                    <StoryCard
                        icon="✨"
                        label="How Debate Improved the Answer"
                        color="violet"
                        content={improvement}
                    />
                )}
            </div>
        </div>
    );
}

// ── Story card ────────────────────────────────────────────────────────────────

type CardColor = "amber" | "rose" | "indigo" | "emerald" | "violet";

const colorMap: Record<CardColor, { border: string; label: string; badge: string }> = {
    amber: { border: "border-amber-500/30", label: "text-amber-300", badge: "bg-amber-500/20 text-amber-200" },
    rose: { border: "border-rose-500/30", label: "text-rose-300", badge: "bg-rose-500/20 text-rose-200" },
    indigo: { border: "border-indigo-500/30", label: "text-indigo-300", badge: "bg-indigo-500/20 text-indigo-200" },
    emerald: { border: "border-emerald-500/30", label: "text-emerald-300", badge: "bg-emerald-500/20 text-emerald-200" },
    violet: { border: "border-violet-500/30", label: "text-violet-300", badge: "bg-violet-500/20 text-violet-200" },
};

function StoryCard({
    icon,
    label,
    color,
    content,
    badge,
}: {
    icon: string;
    label: string;
    color: CardColor;
    content: string;
    badge?: string;
}) {
    const c = colorMap[color];
    return (
        <div className={cn("rounded-lg border bg-white/3 px-3 py-2.5", c.border)}>
            <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm">{icon}</span>
                    <span className={cn("text-[11px] font-semibold uppercase tracking-wide", c.label)}>
                        {label}
                    </span>
                </div>
                {badge && (
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0", c.badge)}>
                        {badge}
                    </span>
                )}
            </div>
            <p className="text-[12px] text-white/75 leading-relaxed">{content}</p>
        </div>
    );
}
