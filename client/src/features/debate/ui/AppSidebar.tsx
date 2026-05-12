import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/features/auth/model/auth.store";
import { cn } from "@/shared/lib/cn";

export default function AppSidebar() {
    const navigate = useNavigate();
    const logout = useAuthStore((s) => s.logout);
    const user = useAuthStore((s) => s.user);

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    return (
        <aside className="w-[220px] shrink-0 h-screen flex flex-col border-r border-agora-border bg-agora-surface/60 backdrop-blur-sm">
            {/* Logo */}
            <div className="px-5 py-5 flex items-center gap-3 border-b border-agora-border/50">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
                    A
                </div>
                <div>
                    <h1 className="text-sm font-semibold text-white leading-tight">AGORA</h1>
                    <p className="text-[10px] text-agora-text-muted">AI Debate Workspace</p>
                </div>
            </div>

            {/* Nav items */}
            <nav className="flex-1 px-3 py-4 space-y-1">
                <NavLink
                    to="/debates"
                    end
                    className={({ isActive }) =>
                        cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all",
                            isActive
                                ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                : "text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40",
                        )
                    }
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Debates
                </NavLink>

                <NavLink
                    to="/debates"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40 transition-all"
                    onClick={(e) => {
                        e.preventDefault();
                        // Scroll to new debate form on the debates page
                        navigate("/debates", { state: { openNew: true } });
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    New Debate
                </NavLink>

                <div className="pt-4 mt-4 border-t border-agora-border/30">
                    <NavLink
                        to="/documents"
                        className={({ isActive }) =>
                            cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all",
                                isActive
                                    ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                    : "text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40",
                            )
                        }
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                        </svg>
                        Documents
                    </NavLink>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs text-agora-text-muted/40 cursor-default">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M8 5.5v3l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        Settings
                    </div>
                </div>
            </nav>

            {/* User footer */}
            <div className="px-4 py-4 border-t border-agora-border/50">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-agora-surface-light flex items-center justify-center text-[10px] font-bold text-agora-text-muted uppercase">
                        {user?.email?.[0] ?? "?"}
                    </div>
                    <span className="text-[11px] text-agora-text-muted truncate flex-1">
                        {user?.email}
                    </span>
                </div>
                <button
                    onClick={handleLogout}
                    className="w-full text-left px-2 py-1.5 rounded text-[11px] text-agora-text-muted/70 hover:text-white hover:bg-agora-surface-light/30 transition-colors"
                >
                    Sign out
                </button>
            </div>
        </aside>
    );
}
