import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import AgoraLogoIcon from "./AgoraLogoIcon";
import { useAuthStore } from "@/features/auth/model/auth.store";
import { cn } from "@/shared/lib/cn";

function SidebarToggleIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <line x1="6" y1="2.5" x2="6" y2="15.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
    );
}

const navItems = [
    {
        to: "/debates",
        end: true,
        label: "Debates",
        icon: (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        to: "/documents",
        end: false,
        label: "Documents",
        icon: (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        to: "/agent-presets",
        end: false,
        label: "Agent Presets",
        icon: (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M11.5 7.5l1 1 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
    },
];

interface AppSidebarProps {
    /** When true, render as a full-height mobile drawer (no collapse toggle). */
    mobile?: boolean;
    /** Invoked after a navigation action so the parent can close the drawer. */
    onNavigate?: () => void;
}

export default function AppSidebar({ mobile = false, onNavigate }: AppSidebarProps) {
    const navigate = useNavigate();
    const logout = useAuthStore((s) => s.logout);
    const user = useAuthStore((s) => s.user);
    const [collapsed, setCollapsed] = useState(false);
    const [logoHovered, setLogoHovered] = useState(false);

    // The collapse affordance is desktop-only; on mobile the sidebar is a drawer.
    const isCollapsed = mobile ? false : collapsed;

    const handleLogout = () => {
        logout();
        onNavigate?.();
        navigate("/login");
    };

    return (
        <aside
            className={cn(
                "shrink-0 h-screen flex flex-col border-r border-agora-border bg-agora-surface/60 backdrop-blur-sm transition-all duration-200",
                mobile ? "w-[240px]" : isCollapsed ? "w-[76px]" : "w-[220px]",
            )}
        >
            {/* Header */}
            {isCollapsed ? (
                <button
                    className="h-[60px] flex items-center justify-center cursor-pointer"
                    onClick={() => setCollapsed(false)}
                    onMouseEnter={() => setLogoHovered(true)}
                    onMouseLeave={() => setLogoHovered(false)}
                    title="Open sidebar"
                >
                    <div className={cn("transition-all duration-150", logoHovered ? "opacity-0 scale-90 absolute" : "opacity-100 scale-100")}>
                        <AgoraLogoIcon size={28} />
                    </div>
                    <div className={cn("transition-all duration-150 text-agora-text-muted", logoHovered ? "opacity-100 scale-100" : "opacity-0 scale-90 absolute")}>
                        <SidebarToggleIcon />
                    </div>
                </button>
            ) : (
                <div className="flex items-center justify-between h-[60px] px-3">
                    <div className="flex items-center gap-2.5">
                        <AgoraLogoIcon size={30} />
                        <h1 className="text-sm font-semibold text-white">AGORA</h1>
                    </div>
                    {!mobile && (
                        <button
                            onClick={() => setCollapsed(true)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-all"
                            title="Collapse sidebar"
                        >
                            <SidebarToggleIcon />
                        </button>
                    )}
                </div>
            )}

            {/* Nav */}
            <nav className="flex-1 px-2 space-y-0.5">
                <button
                    onClick={() => {
                        onNavigate?.();
                        navigate("/debates", { state: { openNew: true } });
                    }}
                    className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40 transition-all",
                        isCollapsed && "justify-center px-0",
                    )}
                    title="New Debate"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    {!isCollapsed && "New Debate"}
                </button>

                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => onNavigate?.()}
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                                isCollapsed && "justify-center px-0",
                                isActive
                                    ? "bg-agora-surface-light text-white"
                                    : "text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40",
                            )
                        }
                        title={item.label}
                    >
                        <span className="shrink-0">{item.icon}</span>
                        {!isCollapsed && item.label}
                    </NavLink>
                ))}
            </nav>

            {/* User footer */}
            <div className={cn("px-3 py-4", isCollapsed && "flex justify-center px-0")}>
                {isCollapsed ? (
                    <button
                        onClick={handleLogout}
                        title={user?.email ?? "Sign out"}
                        className="w-8 h-8 rounded-full bg-agora-surface-light flex items-center justify-center text-[11px] font-bold text-agora-text-muted uppercase hover:text-white transition-colors"
                    >
                        {user?.email?.[0] ?? "?"}
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-agora-surface-light flex items-center justify-center text-[11px] font-bold text-white uppercase shrink-0">
                            {user?.email?.[0] ?? "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-agora-text-muted truncate">{user?.email}</p>
                            <button
                                onClick={handleLogout}
                                className="text-[10px] text-agora-text-muted/60 hover:text-white transition-colors"
                            >
                                Sign out
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}
