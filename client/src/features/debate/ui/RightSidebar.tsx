/**
 * RightSidebar — Step 27.1 (dynamic width per tab + Agents tab).
 *
 * Tabs: Moderator / Evolution / Agents / Raw.
 * Width is tab-aware (Evolution gets the widest band because it carries
 * long reasoning text). Width transition is smooth so the central graph
 * resizes calmly via flex-1.
 */
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import ModeratorPanel from "./ModeratorPanel";
import DebateEvolutionPanel from "./DebateEvolutionPanel";
import RawOutputPanel from "./RawOutputPanel";
import AgentsPanel from "./AgentsPanel";
import { useDebateStore } from "../model/debate.store";

type Tab = "moderator" | "evolution" | "agents" | "raw";

const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "moderator", label: "Moderator", icon: "◐" },
    { id: "evolution", label: "Evolution", icon: "↗" },
    { id: "agents", label: "Agents", icon: "◇" },
    { id: "raw", label: "Raw", icon: "{ }" },
];

/** Per-tab widths as vw-based clamps so the sidebar scales with the viewport. */
const TAB_WIDTHS: Record<Tab, string> = {
    moderator: "clamp(150px, 21vw, 340px)",
    evolution: "clamp(160px, 25vw, 420px)",
    agents:    "clamp(150px, 22vw, 360px)",
    raw:       "clamp(155px, 23vw, 380px)",
};

export default function RightSidebar() {
    const [active, setActive] = useState<Tab>("moderator");
    const followUps = useDebateStore((s) => s.session?.latest_turn?.follow_ups ?? []);
    // Auto-switch to Evolution tab the first time a follow-up cycle exists,
    // so users discover the new feature naturally.
    const [autoSwitched, setAutoSwitched] = useState(false);
    useEffect(() => {
        if (!autoSwitched && followUps.length >= 1) {
            setAutoSwitched(true);
            setActive("evolution");
        }
    }, [followUps.length, autoSwitched]);

    return (
        <div
            className="h-full border-l border-agora-border bg-agora-surface/60 backdrop-blur-sm flex flex-col transition-[width] duration-300 ease-out shrink-0"
            style={{ width: TAB_WIDTHS[active] }}
        >
            <div className="flex items-center px-1 pt-1 gap-0.5 border-b border-agora-border bg-agora-bg/40">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActive(t.id)}
                        className={cn(
                            "flex-1 px-1 py-1.5 text-[10px] font-medium rounded-t-md transition-colors flex items-center justify-center gap-1",
                            active === t.id
                                ? "bg-agora-surface/80 text-white border-t border-l border-r border-agora-border"
                                : "text-agora-text-muted hover:text-white hover:bg-agora-surface/40",
                        )}
                        title={t.label}
                    >
                        <span className="opacity-70">{t.icon}</span>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 min-h-0">
                {active === "moderator" && <ModeratorPanel />}
                {active === "evolution" && <DebateEvolutionPanel />}
                {active === "agents" && <AgentsPanel />}
                {active === "raw" && <RawOutputPanel />}
            </div>
        </div>
    );
}
