import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import AppSidebar from "./AppSidebar";
import AgoraLogoIcon from "./AgoraLogoIcon";
import { useIsMobile } from "@/hooks/useMediaQuery";

export default function AppShell() {
    const isMobile = useIsMobile();
    const [drawerOpen, setDrawerOpen] = useState(false);

    if (!isMobile) {
        return (
            <div className="h-screen overflow-hidden flex bg-agora-bg">
                <AppSidebar />
                <main className="flex-1 min-w-0 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        );
    }

    return (
        <div className="h-dvh overflow-hidden flex flex-col bg-agora-bg">
            {/* Mobile top bar */}
            <header className="h-14 shrink-0 flex items-center gap-3 px-3 border-b border-agora-border bg-agora-surface/80 backdrop-blur-sm">
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-all"
                    aria-label="Open menu"
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                </button>
                <div className="flex items-center gap-2">
                    <AgoraLogoIcon size={26} />
                    <span className="text-sm font-semibold text-white">AGORA</span>
                </div>
            </header>

            <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
                <Outlet />
            </main>

            {/* Slide-out drawer */}
            <AnimatePresence>
                {drawerOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 z-40 bg-black/60"
                            onClick={() => setDrawerOpen(false)}
                        />
                        <motion.div
                            initial={{ x: -260 }}
                            animate={{ x: 0 }}
                            exit={{ x: -260 }}
                            transition={{ type: "tween", duration: 0.22 }}
                            className="fixed inset-y-0 left-0 z-50"
                        >
                            <AppSidebar mobile onNavigate={() => setDrawerOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
