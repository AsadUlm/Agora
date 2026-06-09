import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import TopTopicBar from "./TopTopicBar";
import DebateTimeline from "./DebateTimeline";
import DebateGraphCanvas from "./DebateGraphCanvas";
import RightSidebar from "./RightSidebar";
import PlaybackBar from "./PlaybackBar";
import NodeDetailDrawer from "./NodeDetailDrawer";
import FollowUpInput from "./FollowUpInput";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { useDebateStore } from "@/features/debate/model/debate.store";
import { useDebateViewState } from "@/features/debate/model/useDebateViewState";
import type { DebateBannerState } from "@/features/debate/model/debate-view-state";

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

export default function DebateLayout() {
    const isMobile = useIsMobile();
    const view = useDebateViewState();
    const loadDebate = useDebateStore((s) => s.loadDebate);
    const debateId = useDebateStore((s) => s.debateId);

    const handleReload = debateId
        ? () => void loadDebate(debateId)
        : undefined;

    if (isMobile) {
        return <MobileDebateLayout banner={view.banner} onReload={handleReload} />;
    }

    return (
        <div className="h-screen w-full flex flex-col bg-agora-bg overflow-hidden">
            {/* Generation failure banner — shown INSIDE the page, not as a full-page error */}
            <LifecycleBanner banner={view.banner} onReload={handleReload} />
            {/* Top Bar */}
            <TopTopicBar />

            {/* Main Area: 3-column */}
            <div className="flex-1 flex min-h-0">
                {/* Left: Timeline */}
                <DebateTimeline />

                {/* Center: Canvas + follow-up input, drawer anchored here */}
                <div className="flex-1 relative flex flex-col min-w-0 min-h-0 overflow-hidden">
                    <div className="flex-1 relative min-h-0">
                        <DebateGraphCanvas />
                    </div>
                    <FollowUpInput />
                    {/* Drawer is absolute within this column so it covers canvas + follow-up */}
                    <NodeDetailDrawer />
                </div>

                {/* Right: Unified panel (Moderator / Evolution / Raw) */}
                <RightSidebar />
            </div>
            {/* PlaybackBar spans full width below all three columns */}
            <PlaybackBar />
        </div>
    );
}

type MobilePanel = "rounds" | "panels" | null;

function MobileDebateLayout({
    banner,
    onReload,
}: {
    banner: DebateBannerState;
    onReload?: () => void;
}) {
    const [panel, setPanel] = useState<MobilePanel>(null);

    return (
        <div className="h-dvh w-full flex flex-col bg-agora-bg overflow-hidden">
            <LifecycleBanner banner={banner} onReload={onReload} />
            <TopTopicBar />

            {/* Canvas fills the remaining space */}
            <div className="flex-1 relative flex flex-col min-w-0 min-h-0 overflow-hidden">
                <div className="flex-1 relative min-h-0">
                    <DebateGraphCanvas />

                    {/* Floating panel toggles */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-between px-3">
                        <button
                            onClick={() => setPanel("rounds")}
                            className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-agora-surface/90 border border-agora-border text-agora-text shadow-lg backdrop-blur-sm"
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            Stages
                        </button>
                        <button
                            onClick={() => setPanel("panels")}
                            className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-agora-surface/90 border border-agora-border text-agora-text shadow-lg backdrop-blur-sm"
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
                <NodeDetailDrawer />
            </div>

            <PlaybackBar />

            {/* Bottom-sheet drawers for Timeline / Right panels */}
            <AnimatePresence>
                {panel && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 z-40 bg-black/60"
                            onClick={() => setPanel(null)}
                        />
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "tween", duration: 0.26 }}
                            className={cn(
                                "fixed inset-x-0 bottom-0 z-50 flex flex-col border-t border-agora-border bg-agora-surface overflow-hidden",
                                panel === "panels" ? "h-dvh" : "h-[75dvh] rounded-t-2xl",
                            )}
                        >
                            <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-agora-border">
                                <span className="text-xs font-semibold uppercase tracking-widest text-agora-text-muted">
                                    {panel === "rounds" ? "Stages" : "Insights"}
                                </span>
                                <button
                                    onClick={() => setPanel(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-agora-text-muted hover:text-white"
                                    aria-label="Close"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>
                            <div className="flex-1 min-h-0 overflow-hidden">
                                {panel === "rounds" ? (
                                    <DebateTimeline mobile />
                                ) : (
                                    <RightSidebar mobile />
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
