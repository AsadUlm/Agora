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

export default function DebateLayout() {
    const isMobile = useIsMobile();

    if (isMobile) {
        return <MobileDebateLayout />;
    }

    return (
        <div className="h-screen w-full flex flex-col bg-agora-bg overflow-hidden">
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

function MobileDebateLayout() {
    const [panel, setPanel] = useState<MobilePanel>(null);

    return (
        <div className="h-dvh w-full flex flex-col bg-agora-bg overflow-hidden">
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
                            Rounds
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
                                    {panel === "rounds" ? "Rounds" : "Insights"}
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
