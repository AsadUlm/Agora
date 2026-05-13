import { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import {
    listDebates,
    createSession,
    uploadDocument,
    uploadDocumentsBatch,
    listDocuments,
    deleteDocument,
} from "@/features/debate/api/debate.api";
import type {
    DebateListItem,
    DocumentDTO,
    DocumentUploadFailureDTO,
} from "@/features/debate/api/debate.types";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/dates";
import {
    DEFAULT_AGENT_CONFIGS,
    agentConfigsToPayload,
    createAgentConfig,
    type AgentConfig,
} from "@/features/debate/model/agent-config.types";
import AgentConfigDrawer from "@/features/debate/ui/AgentConfigDrawer";
import { useDebateStore } from "@/features/debate/model/debate.store";

export default function DebateListPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const startDebate = useDebateStore((s) => s.startDebate);
    const [debates, setDebates] = useState<DebateListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [question, setQuestion] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>(
        () => [...DEFAULT_AGENT_CONFIGS],
    );

    // Document management state
    const [draftSessionId, setDraftSessionId] = useState<string | null>(null);
    const [documents, setDocuments] = useState<DocumentDTO[]>([]);
    const [uploading, setUploading] = useState(false);

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

    // Handle "New Debate" from sidebar
    useEffect(() => {
        if ((location.state as { openNew?: boolean })?.openNew) {
            setShowNew(true);
            // Clear the state so it doesn't re-trigger
            window.history.replaceState({}, "");
        }
    }, [location.state]);

    const handleCreate = async () => {
        if (!question.trim() || enabledCount === 0) return;
        setCreating(true);
        try {
            const res = await startDebate(
                question.trim(),
                agentConfigsToPayload(agentConfigs),
                // Backend executes the full pipeline automatically; the
                // frontend playback queue controls visual reveal.
                "auto",
                draftSessionId ? { sessionId: draftSessionId } : undefined,
            );
            // Reset draft state after successful creation
            setDraftSessionId(null);
            setDocuments([]);
            navigate(`/debates/${res.debate_id}`);
        } catch {
            /* error shown inline */
        } finally {
            setCreating(false);
        }
    };

    /** Ensure a draft session exists for document uploads. */
    const ensureDraftSession = async (): Promise<string> => {
        if (draftSessionId) return draftSessionId;
        const sess = await createSession();
        setDraftSessionId(sess.id);
        return sess.id;
    };

    const handleUploadDocument = async (file: File) => {
        setUploading(true);
        try {
            const sessionId = await ensureDraftSession();
            const doc = await uploadDocument(sessionId, file);
            setDocuments((prev) => [doc, ...prev]);
        } finally {
            setUploading(false);
        }
    };

    /** Step 30: multi-file upload. Returns per-file failures so the panel can show them. */
    const handleUploadDocumentsBatch = async (
        files: File[],
    ): Promise<DocumentUploadFailureDTO[] | void> => {
        setUploading(true);
        try {
            const sessionId = await ensureDraftSession();
            const res = await uploadDocumentsBatch(sessionId, files);
            if (res.uploaded.length) {
                setDocuments((prev) => [...res.uploaded, ...prev]);
            }
            return res.failed;
        } finally {
            setUploading(false);
        }
    };

    const handleDeleteDocument = async (documentId: string) => {
        if (!draftSessionId) return;
        try {
            await deleteDocument(documentId, draftSessionId);
            setDocuments((prev) => prev.filter((d) => d.id !== documentId));
            // Clear documentIds from all agent configs
            setAgentConfigs((prev) =>
                prev.map((a) => ({
                    ...a,
                    documentIds: a.documentIds.filter((id) => id !== documentId),
                })),
            );
        } catch {
            /* ignore */
        }
    };

    // Refresh documents when drawer opens (in case status changed)
    const handleOpenDrawer = async () => {
        setDrawerOpen(true);
        if (draftSessionId) {
            try {
                const docs = await listDocuments(draftSessionId);
                setDocuments(docs);
            } catch {
                /* ignore */
            }
        }
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

    const [page, setPage] = useState(1);
    const PAGE_SIZE = 10;
    const totalPages = Math.ceil(debates.length / PAGE_SIZE);
    const visibleDebates = debates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
                documents={documents.map((d) => ({ id: d.id, filename: d.filename, status: d.status }))}
                rawDocuments={documents}
                uploading={uploading}
                onUploadDocument={handleUploadDocument}
                onUploadDocumentsBatch={handleUploadDocumentsBatch}
                onDeleteDocument={handleDeleteDocument}
            />

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
                                        onClick={handleOpenDrawer}
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
                                    {documents.length > 0 && (
                                        <span className="text-[10px] text-indigo-400/80 flex items-center gap-1">
                                            📄 {documents.length} doc{documents.length !== 1 ? "s" : ""}
                                        </span>
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
                        {visibleDebates.map((debate, idx) => (
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

                    {totalPages > 1 && (
                        <div className="mt-6 pt-4 border-t border-agora-border">
                            <div className="flex items-center justify-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => p - 1)}
                                    disabled={page === 1}
                                    className="px-3 py-1.5 rounded-lg text-xs border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    ← Prev
                                </button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPage(p)}
                                        className={cn(
                                            "w-8 h-8 rounded-lg text-xs font-medium transition-colors border",
                                            p === page
                                                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                                                : "border-transparent text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50",
                                        )}
                                    >
                                        {p}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={page === totalPages}
                                    className="px-3 py-1.5 rounded-lg text-xs border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
