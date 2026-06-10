import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopTopicBar from "./TopTopicBar";
import DebateGraphCanvas from "./DebateGraphCanvas";
import RightSidebar from "./RightSidebar";
import PlaybackBar from "./PlaybackBar";
import FollowUpInput from "./FollowUpInput";
import { useIsMobile, useIsTablet } from "@/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { useDebateStore } from "@/features/debate/model/debate.store";
import { useDebateViewState } from "@/features/debate/model/useDebateViewState";
import type { DebateBannerState } from "@/features/debate/model/debate-view-state";
import { useDebateFocusStore } from "@/features/debate/model/debate-focus.store";
import { useSelectedCycleState } from "@/features/debate/model/useSelectedCycleState";

function LifecycleBanner({ banner, onReload }: { banner: DebateBannerState; onReload?: () => void }) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed || banner.type === "none") return null;
    const warning = banner.type === "warning";
    const info = banner.type === "info";
    const palette = info
        ? "bg-indigo-950/70 border-indigo-700/50 text-indigo-200"
        : warning
            ? "bg-amber-950/70 border-amber-700/50 text-amber-200"
            : "bg-red-950/70 border-red-700/50 text-red-200";

    return (
        <AnimatePresence>
            <motion.div
                className={cn("relative flex items-start gap-3 px-4 py-3 border-b text-sm", palette)}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
            >
                <span className="mt-0.5 shrink-0">⚠</span>
                <div className="flex-1 min-w-0">
                    <span className="font-medium">{banner.title}: </span>
                    <span>{banner.message}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {onReload && (
                        <button
                            onClick={onReload}
                            className="px-3 py-1 rounded text-xs font-medium bg-white/10 hover:bg-white/20 text-white transition-colors"
                            title="Reload the current debate state from the server"
                        >
                            Reload status
                        </button>
                    )}
                    <button
                        onClick={() => setDismissed(true)}
                        className="opacity-70 hover:opacity-100 transition-opacity px-1"
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}

export type WorkspaceTab = "overview" | "debate_process" | "followup" | "debug";

export default function DebateLayout() {
    const isMobile = useIsMobile();
    const isTablet = useIsTablet();
    const view = useDebateViewState();
    const { cycle, state: cycleState } = useSelectedCycleState();
    const loadDebate = useDebateStore((s) => s.loadDebate);
    const debateId = useDebateStore((s) => s.debateId);

    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");

    // Auto-switch to Debate Process tab when the user clicks a graph element
    const focusTarget = useDebateFocusStore((s) => s.focusTarget);
    useEffect(() => {
        if (focusTarget === null) return;
        const timer = window.setTimeout(() => setWorkspaceTab("debate_process"), 0);
        return () => window.clearTimeout(timer);
    }, [focusTarget]);

    const handleReload = debateId
        ? () => void loadDebate(debateId)
        : undefined;

    const handleTabChange = (tab: WorkspaceTab) => {
        setWorkspaceTab(tab);
    };
    const selectedBanner: DebateBannerState = cycleState.status === "partially_completed"
        ? {
            type: "warning",
            title: `${cycle.title} partially completed`,
            message: cycleState.hasUpdatedSynthesis
                ? "Updated synthesis is available, but some follow-up exchange stages are incomplete."
                : "Updated synthesis was not generated. Available cycle results remain visible.",
        }
        : cycleState.status === "failed"
            ? {
                type: "error",
                title: `${cycle.title} failed`,
                message: view.error?.userMessage ?? "This cycle ended without usable results.",
            }
            : view.derivedStatus === "interrupted" && cycleState.status === "running"
                ? view.banner
                : { type: "none", title: "", message: "" };

    if (isMobile || isTablet) {
        return <CompactDebateLayout banner={selectedBanner} onReload={handleReload} />;
    }

    return (
        <div className="h-screen w-full flex flex-col bg-agora-bg overflow-hidden">
            {/* Generation failure banner — shown INSIDE the page, not as a full-page error */}
            <LifecycleBanner banner={selectedBanner} onReload={handleReload} />
            {/* Top Bar */}
            <TopTopicBar />

            {/* Main Area: 2-column */}
            <div className="flex-1 flex min-h-0">
                {/* Center: graph is a visual map; details live in the right panel. */}
                <div className="flex-1 relative flex flex-col min-w-0 min-h-0 overflow-hidden">
                    <div className="flex-1 relative min-h-0">
                        <DebateGraphCanvas />
                    </div>
                    <FollowUpInput />
                </div>

                {/* Right: Unified panel (Overview, Debate Process, Follow-up, Debug) */}
                <RightSidebar
                    activeTab={workspaceTab}
                    onTabChange={handleTabChange}
                />
            </div>
            {/* PlaybackBar spans full width below all three columns */}
            <PlaybackBar />
        </div>
    );
}

function CompactDebateLayout({
    banner,
    onReload,
}: {
    banner: DebateBannerState;
    onReload?: () => void;
}) {
    const [insightsOpen, setInsightsOpen] = useState(false);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("overview");
    const focusTarget = useDebateFocusStore((s) => s.focusTarget);

    useEffect(() => {
        if (!focusTarget) return;
        const timer = window.setTimeout(() => {
            setWorkspaceTab("debate_process");
            setInsightsOpen(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [focusTarget]);

    return (
        <div className="h-dvh w-full flex flex-col bg-agora-bg overflow-hidden">
            <LifecycleBanner banner={banner} onReload={onReload} />
            <TopTopicBar />

            {/* Canvas fills the remaining space */}
            <div className="flex-1 relative flex flex-col min-w-0 min-h-0 overflow-hidden">
                <div className="flex-1 relative min-h-0">
                    <DebateGraphCanvas />

                    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-end px-3">
                        <button
                            onClick={() => setInsightsOpen(true)}
                            className="pointer-events-auto min-h-11 flex items-center gap-2 px-4 rounded-full text-xs font-semibold bg-violet-600 border border-violet-400/40 text-white shadow-lg shadow-violet-950/40 backdrop-blur-sm"
                        >
                            Insights
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                                <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>
                <FollowUpInput />
            </div>

            <PlaybackBar />

            {/* Bottom-sheet drawers for Timeline / Right panels */}
            <AnimatePresence>
                {insightsOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 z-40 bg-black/60"
                            onClick={() => setInsightsOpen(false)}
                        />
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "tween", duration: 0.26 }}
                            className="fixed inset-x-0 bottom-0 z-50 flex h-[min(80dvh,760px)] flex-col overflow-hidden rounded-t-2xl border-t border-agora-border bg-agora-surface shadow-2xl"
                        >
                            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />
                            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-agora-border">
                                <span className="text-xs font-semibold uppercase tracking-widest text-agora-text-muted">
                                    Insights
                                </span>
                                <button
                                    onClick={() => setInsightsOpen(false)}
                                    className="w-11 h-11 flex items-center justify-center rounded-lg text-agora-text-muted hover:text-white"
                                    aria-label="Close"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-hidden">
                                <RightSidebar mobile activeTab={workspaceTab} onTabChange={setWorkspaceTab} />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
