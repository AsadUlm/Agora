/**
 * RightSidebar — Simplified 4-tab information architecture.
 *
 * Tabs:
 *   Overview       — Final answer, 3-phase summary, live status (default)
 *   Debate Process — Argument Exchange + Position Evolution (merged)
 *   Follow-up      — Only when follow-up cycles exist
 *   Debug          — Raw JSON + lifecycle debug (developer-oriented)
 *
 * Removed tabs: Debate Flow, Changes, Guide, Cycles, Agents, Raw
 * (content was merged or moved to remaining tabs)
 */
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import DebateOverviewPanel from "./DebateOverviewPanel";
import DebateProcessPanel from "./DebateProcessPanel";
import DebateEvolutionPanel from "./DebateEvolutionPanel";
import RawOutputPanel from "./RawOutputPanel";
import { useDebateStore } from "../model/debate.store";

type Tab = "overview" | "debate_process" | "followup" | "debug";

/** Per-tab widths as vw-based clamps so the sidebar scales with the viewport. */
const TAB_WIDTHS: Record<Tab, string> = {
    overview:       "clamp(240px, 30vw, 520px)",
    debate_process: "clamp(240px, 32vw, 560px)",
    followup:       "clamp(200px, 28vw, 460px)",
    debug:          "clamp(155px, 23vw, 380px)",
};

export default function RightSidebar({ mobile = false }: { mobile?: boolean }) {
    const [active, setActive] = useState<Tab>("overview");
    const followUps = useDebateStore((s) => s.session?.latest_turn?.follow_ups ?? []);
    const hasFollowUps = followUps.length > 0;

    // Auto-switch to Follow-up tab the first time a follow-up cycle appears.
    const [autoSwitched, setAutoSwitched] = useState(false);
    useEffect(() => {
        if (!autoSwitched && hasFollowUps) {
            setAutoSwitched(true);
            setActive("followup");
        }
    }, [hasFollowUps, autoSwitched]);

    // If follow-up tab disappears (e.g. data cleared) and user is on it, go back to overview.
    useEffect(() => {
        if (active === "followup" && !hasFollowUps) {
            setActive("overview");
        }
    }, [active, hasFollowUps]);

    const TABS: { id: Tab; label: string; icon: string; highlight?: boolean; badge?: string }[] = [
        { id: "overview",       label: "Overview",        icon: "🧭", highlight: true },
        { id: "debate_process", label: "Debate Process",  icon: "⚔️" },
        ...(hasFollowUps ? [{ id: "followup" as Tab, label: "Follow-up", icon: "↗", badge: String(followUps.length) }] : []),
        { id: "debug",          label: "Debug",           icon: "{ }" },
    ];

    return (
        <div
            className={cn(
                "h-full bg-agora-surface/60 backdrop-blur-sm flex flex-col transition-[width] duration-300 ease-out shrink-0",
                mobile ? "w-full" : "border-l border-agora-border",
            )}
            style={mobile ? undefined : { width: TAB_WIDTHS[active] }}
        >
            {/* Tab bar */}
            <div className="flex items-center px-1 pt-1 gap-0.5 border-b border-agora-border bg-agora-bg/40 flex-wrap">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActive(t.id)}
                        className={cn(
                            "px-1.5 py-1.5 text-[10px] font-medium rounded-t-md transition-colors flex items-center justify-center gap-1 whitespace-nowrap",
                            active === t.id
                                ? "bg-agora-surface/80 text-white border-t border-l border-r border-agora-border"
                                : t.highlight
                                    ? "text-violet-300 hover:text-white hover:bg-agora-surface/40"
                                    : "text-agora-text-muted hover:text-white hover:bg-agora-surface/40",
                        )}
                        title={t.label}
                    >
                        <span className="opacity-80">{t.icon}</span>
                        {t.label}
                        {/* Violet dot for Overview when not active */}
                        {t.highlight && active !== t.id && (
                            <span className="w-1 h-1 rounded-full bg-violet-400 inline-block" />
                        )}
                        {/* Badge for Follow-up count */}
                        {t.badge && (
                            <span className="px-1 rounded-full bg-violet-500/30 text-violet-200 text-[9px] font-semibold">
                                {t.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {active === "overview" && (
                    <div className="p-3">
                        <DebateOverviewPanel onNavigate={(tab) => {
                            setActive(tab);
                        }} />
                    </div>
                )}
                {active === "debate_process" && (
                    <div className="p-3">
                        <DebateProcessPanel />
                    </div>
                )}
                {active === "followup" && <DebateEvolutionPanel />}
                {active === "debug" && <RawOutputPanel />}
            </div>
        </div>
    );
}
