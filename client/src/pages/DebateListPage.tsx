import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { listDebates, startDebate } from "@/features/debate/api/debate.api";
import type { DebateListItem } from "@/features/debate/api/debate.types";
import { useAuthStore } from "@/features/auth/model/auth.store";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/dates";
import {
    DEFAULT_AGENT_CONFIGS,
    agentConfigsToPayload,
    createAgentConfig,
    type AgentConfig,
} from "@/features/debate/model/agent-config.types";
import AgentConfigDrawer from "@/features/debate/ui/AgentConfigDrawer";

export default function DebateListPage() {
    const navigate = useNavigate();
    const logout = useAuthStore((s) => s.logout);
    const user = useAuthStore((s) => s.user);
    const [debates, setDebates] = useState<DebateListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [question, setQuestion] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>(
        () => [...DEFAULT_AGENT_CONFIGS],
    );

    const enabledCount = agentConfigs.filter((a) => a.enabled).length;

    const fetchDebates = useCallback(async () => {
        try {
            const data = await listDebates();
            setDebates(data);
        } catch {
            /* ignore */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDebates();
    }, [fetchDebates]);

    const handleCreate = async () => {
        if (!question.trim() || enabledCount === 0) return;
        setCreating(true);
        try {
            const res = await startDebate({
                question: question.trim(),
                agents: agentConfigsToPayload(agentConfigs),
            });
            navigate(`/debates/${res.debate_id}`);
        } catch {
            /* error shown inline */
        } finally {
            setCreating(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const handleUpdateAgent = (id: string, updates: Partial<AgentConfig>) => {
        setAgentConfigs((prev) =>
            prev.map((a) => (a._id === id ? { ...a, ...updates } : a)),
        );
    };

    const handleRemoveAgent = (id: string) => {
        setAgentConfigs((prev) => prev.filter((a) => a._id !== id));
    };

    const handleAddAgent = (agent?: AgentConfig) => {
        setAgentConfigs((prev) => [...prev, agent ?? createAgentConfig()]);
    };

    const handleMoveAgent = (id: string, direction: "up" | "down") => {
        setAgentConfigs((prev) => {
            const idx = prev.findIndex((a) => a._id === id);
            if (idx < 0) return prev;
            const targetIdx = direction === "up" ? idx - 1 : idx + 1;
            if (targetIdx < 0 || targetIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
            return next;
        });
    };

    const statusColors: Record<string, string> = {
        queued: "bg-amber-500/20 text-amber-400",
        running: "bg-indigo-500/20 text-indigo-400",
        completed: "bg-emerald-500/20 text-emerald-400",
        failed: "bg-red-500/20 text-red-400",
    };

    return (
        <div className="min-h-screen bg-agora-bg">
            {/* Agent drawer */}
            <AgentConfigDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                agents={agentConfigs}
                onUpdate={handleUpdateAgent}
                onRemove={handleRemoveAgent}
                onAdd={handleAddAgent}
                onMove={handleMoveAgent}
            />

            {/* Header */}
            <header className="border-b border-agora-border bg-agora-surface/80 backdrop-blur-sm">
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
                            A
                        </div>
                        <div>
                            <h1 className="text-base font-semibold text-white">AGORA</h1>
                            <p className="text-[11px] text-agora-text-muted">
                                AI Debate Workspace
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-agora-text-muted">
                            {user?.email}
                        </span>
                        <button
                            onClick={handleLogout}
                            className="text-xs text-agora-text-muted hover:text-white transition-colors"
                        >
                            Sign out
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-8">
                {/* New debate block */}
                <div className="mb-8">
                    {!showNew ? (
                        <motion.button
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => setShowNew(true)}
                            className="w-full p-6 rounded-2xl border-2 border-dashed border-agora-border hover:border-indigo-500/40 bg-agora-surface/30 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 text-lg">
                                    +
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white">
                                        Start a new debate
                                    </div>
                                    <div className="text-xs text-agora-text-muted">
                                        Ask a question and watch AI agents reason through it
                                    </div>
                                </div>
                            </div>
                        </motion.button>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-agora-border bg-agora-surface overflow-hidden"
                        >
                            {/* Header bar */}
                            <div className="px-6 py-4 border-b border-agora-border flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                        <span className="text-white text-sm">✦</span>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">
                                            New Debate
                                        </h3>
                                        <p className="text-[10px] text-agora-text-muted">
                                            Multi-agent reasoning workspace
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowNew(false)}
                                    className="text-agora-text-muted hover:text-white transition-colors p-1"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>

                            {/* Question input */}
                            <div className="px-6 py-5">
                                <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-2 block">
                                    Question
                                </label>
                                <textarea
                                    autoFocus
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    placeholder="What question should the agents debate?"
                                    className="w-full bg-agora-bg border border-agora-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-none h-28 transition-all"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                            handleCreate();
                                        }
                                    }}
                                />
                            </div>

                            {/* Footer controls */}
                            <div className="px-6 py-4 border-t border-agora-border bg-agora-surface-light/20 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setDrawerOpen(true)}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-agora-surface-light/50 border border-agora-border text-agora-text hover:text-white hover:border-indigo-500/40 transition-all"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
                                            <circle cx="5" cy="6" r="1" fill="currentColor" />
                                            <circle cx="9" cy="6" r="1" fill="currentColor" />
                                            <circle cx="7" cy="9.5" r="1" fill="currentColor" />
                                        </svg>
                                        Configure Agents
                                    </button>
                                    <span className="text-[11px] text-agora-text-muted">
                                        {enabledCount} agent{enabledCount !== 1 ? "s" : ""} active
                                    </span>
                                    {agentConfigs.filter((a) => a.enabled).length > 0 && (
                                        <div className="flex -space-x-1">
                                            {agentConfigs
                                                .filter((a) => a.enabled)
                                                .slice(0, 5)
                                                .map((a) => (
                                                    <div
                                                        key={a._id}
                                                        className="w-5 h-5 rounded-full bg-agora-surface-light border border-agora-border flex items-center justify-center text-[8px] text-agora-text-muted uppercase"
                                                        title={a.role}
                                                    >
                                                        {a.role[0]}
                                                    </div>
                                                ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-gray-600">
                                        Ctrl+Enter
                                    </span>
                                    <button
                                        onClick={handleCreate}
                                        disabled={!question.trim() || creating || enabledCount === 0}
                                        className={cn(
                                            "px-5 py-2 rounded-lg text-xs font-semibold transition-all",
                                            question.trim() && !creating && enabledCount > 0
                                                ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/25"
                                                : "bg-gray-700 text-gray-500 cursor-not-allowed",
                                        )}
                                    >
                                        {creating ? (
                                            <span className="flex items-center gap-2">
                                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Starting…
                                            </span>
                                        ) : (
                                            "Start Debate →"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* Debate list */}
                <div>
                    <h2 className="text-xs uppercase tracking-widest text-agora-text-muted font-semibold mb-4">
                        Your Debates
                    </h2>

                    {loading && (
                        <div className="text-center py-12">
                            <p className="text-agora-text-muted text-sm">Loading...</p>
                        </div>
                    )}

                    {!loading && debates.length === 0 && (
                        <div className="text-center py-12">
                            <p className="text-4xl mb-3">🎯</p>
                            <p className="text-agora-text-muted text-sm">
                                No debates yet. Start your first one above.
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        {debates.map((debate, idx) => (
                            <motion.button
                                key={debate.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                onClick={() => navigate(`/debates/${debate.id}`)}
                                className="w-full text-left p-4 rounded-xl border border-agora-border bg-agora-surface/50 hover:bg-agora-surface hover:border-agora-border transition-all"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-white truncate">
                                            {debate.question || debate.title}
                                        </div>
                                        <div className="text-[11px] text-agora-text-muted mt-1">
                                            {formatRelativeTime(debate.created_at)}
                                        </div>
                                    </div>
                                    <span
                                        className={cn(
                                            "px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0",
                                            statusColors[debate.status] ??
                                            "bg-gray-500/20 text-gray-400",
                                        )}
                                    >
                                        {debate.status}
                                    </span>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}
