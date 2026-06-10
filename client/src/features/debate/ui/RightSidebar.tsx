/**
 * RightSidebar — Simplified 3-tab information architecture (Overview, Follow-up, Debug).
 *
 * Promoted "Debate Process" to the central workspace panel.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/cn";
import DebateOverviewPanel from "./DebateOverviewPanel";
import DebateProcessPanel from "./DebateProcessPanel";
import DebateEvolutionPanel from "./DebateEvolutionPanel";
import RawOutputPanel from "./RawOutputPanel";
import { useDebateStore } from "../model/debate.store";
import PanelTabs from "./primitives/PanelTabs";

import { type WorkspaceTab } from "./DebateLayout";

type SidebarTab = WorkspaceTab;

const TAB_WIDTHS: Record<SidebarTab, string> = {
    overview:       "clamp(430px, 38vw, 640px)",
    debate_process: "clamp(430px, 38vw, 640px)",
    followup:       "clamp(430px, 38vw, 640px)",
    debug:          "clamp(430px, 38vw, 640px)",
};

interface RightSidebarProps {
    mobile?: boolean;
    activeTab?: SidebarTab;
    onTabChange?: (tab: SidebarTab) => void;
}

export default function RightSidebar({
    mobile = false,
    activeTab = "overview",
    onTabChange,
}: RightSidebarProps) {
    const followUps = useDebateStore((s) => s.session?.latest_turn?.follow_ups ?? []);
    const hasFollowUps = followUps.length > 0;

    const active = activeTab;

    // Auto-switch to Follow-up tab the first time a follow-up cycle appears.
    const autoSwitched = useRef(false);
    useEffect(() => {
        if (!autoSwitched.current && hasFollowUps && onTabChange) {
            autoSwitched.current = true;
            onTabChange("followup");
        }
    }, [hasFollowUps, onTabChange]);

    // If follow-up tab disappears (e.g. data cleared) and user is on it, go back to overview.
    useEffect(() => {
        if (activeTab === "followup" && !hasFollowUps && onTabChange) {
            onTabChange("overview");
        }
    }, [activeTab, hasFollowUps, onTabChange]);

    const TABS: { id: SidebarTab; label: string; icon: string; badge?: string }[] = [
        { id: "overview",       label: "Overview",        icon: "◉" },
        { id: "debate_process", label: mobile ? "Process" : "Debate Process", icon: "↔" },
        ...(hasFollowUps ? [{ id: "followup" as SidebarTab, label: "Follow-up", icon: "↗", badge: String(followUps.length) }] : []),
        { id: "debug",          label: "Debug",           icon: "{ }" },
    ];

    const handleTabClick = (tabId: SidebarTab) => {
        if (onTabChange) {
            onTabChange(tabId);
        }
    };

    return (
        <div
            className={cn(
                "h-full bg-agora-surface/60 backdrop-blur-sm flex flex-col transition-[width] duration-300 ease-out shrink-0",
                mobile ? "w-full" : "border-l border-agora-border",
            )}
            style={mobile ? undefined : { width: TAB_WIDTHS[active] }}
        >
            <PanelTabs tabs={TABS} activeTab={active} onChange={handleTabClick} />

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {active === "overview" && (
                    <div className="p-3 pb-24">
                        <DebateOverviewPanel onNavigate={(tab) => {
                            if (onTabChange) {
                                onTabChange(tab);
                            }
                        }} />
                    </div>
                )}
                {active === "debate_process" && (
                    <div className="p-3 pb-24">
                        <DebateProcessPanel />
                    </div>
                )}
                {active === "followup" && <div className="pb-24"><DebateEvolutionPanel /></div>}
                {active === "debug" && <div className="pb-24"><RawOutputPanel /></div>}
            </div>
        </div>
    );
}
