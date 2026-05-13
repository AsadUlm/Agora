import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
    listAllDocuments,
    deleteDocument,
    downloadDocumentBlob,
} from "@/features/debate/api/debate.api";
import type { DocumentAllItemDTO } from "@/features/debate/api/debate.types";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/dates";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocGroup {
    filename: string;
    source_type: string;
    /** Most recent upload's status — shown on the collapsed row. */
    status: string;
    /** Total bytes of the most recent copy. */
    bytes: number | null | undefined;
    /** All copies, sorted newest-first. */
    copies: DocumentAllItemDTO[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
    ready:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    processing: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
    uploaded:   "bg-gray-500/15 text-gray-300 border-gray-500/25",
    failed:     "bg-red-500/15 text-red-300 border-red-500/25",
};

function formatBytes(bytes: number | null | undefined): string {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function groupByFilename(docs: DocumentAllItemDTO[]): DocGroup[] {
    const map = new Map<string, DocumentAllItemDTO[]>();
    for (const doc of docs) {
        const key = doc.filename.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(doc);
    }
    return Array.from(map.values()).map((copies) => ({
        filename: copies[0].filename,
        source_type: copies[0].source_type,
        status: copies[0].status,
        bytes: copies[0].bytes,
        copies,
    }));
}

function FileIcon({ sourceType }: { sourceType: string }) {
    const ext = (sourceType ?? "").toLowerCase();
    const color =
        ext === "pdf"                    ? "text-red-400" :
        ext === "docx" || ext === "doc"  ? "text-blue-400" :
        ext === "txt"  || ext === "md"   ? "text-gray-400" :
        "text-agora-text-muted";
    return (
        <div className={cn(
            "w-9 h-9 rounded-lg bg-agora-surface-light flex items-center justify-center text-[10px] font-bold uppercase shrink-0",
            color,
        )}>
            {ext.slice(0, 3) || "?"}
        </div>
    );
}

// ── Open / download logic ─────────────────────────────────────────────────────

async function openDocument(doc: DocumentAllItemDTO): Promise<void> {
    // Always proxy through our backend — Cloudinary raw URLs require auth.
    const { blob, filename } = await downloadDocumentBlob(doc.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentsPage() {
    const navigate = useNavigate();
    const [docs, setDocs] = useState<DocumentAllItemDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [opening, setOpening] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<"all" | "ready" | "processing" | "failed">("all");
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 15;

    const fetchDocs = useCallback(async () => {
        try {
            const data = await listAllDocuments();
            setDocs(data);
        } catch {
            /* ignore */
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchDocs(); }, [fetchDocs]);

    const handleDelete = async (doc: DocumentAllItemDTO) => {
        if (!confirm(`Delete "${doc.filename}" from this debate? This cannot be undone.`)) return;
        setDeleting(doc.id);
        try {
            await deleteDocument(doc.id, doc.session_id);
            setDocs((prev) => prev.filter((d) => d.id !== doc.id));
        } catch {
            /* ignore */
        } finally {
            setDeleting(null);
        }
    };

    const handleOpen = async (doc: DocumentAllItemDTO) => {
        setOpening(doc.id);
        try {
            await openDocument(doc);
        } catch {
            /* ignore */
        } finally {
            setOpening(null);
        }
    };

    const toggleExpand = (filename: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(filename)) next.delete(filename);
            else next.add(filename);
            return next;
        });
    };

    const allGroups = groupByFilename(docs);
    const filteredGroups = filter === "all"
        ? allGroups
        : allGroups.filter((g) => g.copies.some((c) => c.status === filter));

    const totalPages = Math.ceil(filteredGroups.length / PAGE_SIZE);
    const visibleGroups = filteredGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // Reset to page 1 whenever filter changes
    useEffect(() => { setPage(1); }, [filter]);

    const counts = {
        all:        allGroups.length,
        ready:      allGroups.filter((g) => g.copies.some((c) => c.status === "ready")).length,
        processing: allGroups.filter((g) => g.copies.some((c) => c.status === "processing")).length,
        failed:     allGroups.filter((g) => g.copies.some((c) => c.status === "failed")).length,
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-agora-bg">
            {/* Header */}
            <div className="px-8 py-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-white">Documents</h1>
                        <p className="text-xs text-agora-text-muted mt-0.5">
                            Knowledge files uploaded across your debates
                        </p>
                    </div>
                    <div className="text-xs text-agora-text-muted">
                        {allGroups.length} unique file{allGroups.length !== 1 ? "s" : ""}
                        {docs.length !== allGroups.length && (
                            <span className="ml-1 opacity-60">({docs.length} total uploads)</span>
                        )}
                    </div>
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1 mt-4">
                    {(["all", "ready", "processing", "failed"] as const).map((tab) => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => setFilter(tab)}
                            className={cn(
                                "px-3 py-1 rounded-md text-xs font-medium transition-colors border",
                                filter === tab
                                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                                    : "text-agora-text-muted border-transparent hover:text-white hover:bg-agora-surface-light/40",
                            )}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            <span className="ml-1.5 opacity-60">{counts[tab]}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-8 py-4">
                {loading ? (
                    <div className="flex items-center justify-center h-40 text-agora-text-muted text-sm">
                        Loading…
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-2 text-agora-text-muted">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="opacity-30">
                            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span className="text-sm">
                            {filter === "all" ? "No documents uploaded yet." : `No ${filter} documents.`}
                        </span>
                        {filter === "all" && (
                            <p className="text-xs opacity-60 text-center max-w-xs">
                                Upload PDFs, Word docs, or text files when creating or continuing a debate — they appear here.
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                    <div className="space-y-2">
                        <AnimatePresence initial={false}>
                            {visibleGroups.map((group, idx) => {
                                const isExpanded = expanded.has(group.filename.toLowerCase());
                                const multi = group.copies.length > 1;

                                return (
                                    <motion.div
                                        key={group.filename.toLowerCase()}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.97 }}
                                        transition={{ delay: idx * 0.02 }}
                                        className="rounded-xl border border-agora-border bg-agora-surface/50 overflow-hidden"
                                    >
                                        {/* ── Collapsed / header row ── */}
                                        <div className="flex items-center gap-4 px-4 py-3 group hover:bg-agora-surface/80 transition-colors">
                                            <FileIcon sourceType={group.source_type} />

                                            <div className="flex-1 min-w-0">
                                                {/* Filename — click to open the most-recent copy */}
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpen(group.copies[0])}
                                                    disabled={opening === group.copies[0].id}
                                                    className="text-sm font-medium text-white hover:text-indigo-300 transition-colors truncate text-left max-w-full disabled:opacity-50"
                                                    title={group.filename}
                                                >
                                                    {opening === group.copies[0].id ? "Opening…" : group.filename}
                                                </button>

                                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                    <span className={cn(
                                                        "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                                                        STATUS_STYLES[group.status] ?? STATUS_STYLES.uploaded,
                                                    )}>
                                                        {group.status}
                                                    </span>
                                                    <span className="text-[11px] text-agora-text-muted/60">
                                                        {formatBytes(group.bytes)}
                                                    </span>
                                                    <span className="text-[11px] text-agora-text-muted/60">
                                                        {formatRelativeTime(group.copies[0].created_at)}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Debate count badge / expand toggle */}
                                            {multi ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpand(group.filename.toLowerCase())}
                                                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-agora-surface-light/60 text-agora-text-muted hover:text-white hover:bg-agora-surface-light transition-colors border border-agora-border"
                                                >
                                                    {group.copies.length} debates
                                                    <svg
                                                        width="10" height="10" viewBox="0 0 10 10" fill="none"
                                                        className={cn("transition-transform", isExpanded && "rotate-180")}
                                                    >
                                                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </button>
                                            ) : (
                                                group.copies[0].session_title && (
                                                    <button
                                                        type="button"
                                                        onClick={() => navigate(`/debates/${group.copies[0].session_id}`)}
                                                        className="shrink-0 text-[11px] text-agora-text-muted hover:text-indigo-300 transition-colors truncate max-w-[200px] text-right"
                                                        title={group.copies[0].session_title}
                                                    >
                                                        {group.copies[0].session_title}
                                                    </button>
                                                )
                                            )}

                                            {/* Delete (single copy) */}
                                            {!multi && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(group.copies[0])}
                                                    disabled={deleting === group.copies[0].id}
                                                    className={cn(
                                                        "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                                                        "p-1.5 rounded-lg text-agora-text-muted hover:text-red-400 hover:bg-red-500/10",
                                                        deleting === group.copies[0].id && "opacity-50 cursor-not-allowed",
                                                    )}
                                                    title="Delete"
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                                        <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>

                                        {/* ── Expanded: per-debate rows ── */}
                                        <AnimatePresence initial={false}>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.18 }}
                                                    className="overflow-hidden border-t border-agora-border/50"
                                                >
                                                    {group.copies.map((copy) => (
                                                        <div
                                                            key={copy.id}
                                                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-agora-surface-light/20 transition-colors group/row"
                                                        >
                                                            <div className="w-1.5 h-1.5 rounded-full bg-agora-border shrink-0 ml-1" />

                                                            <div className="flex-1 min-w-0">
                                                                {copy.session_title ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => navigate(`/debates/${copy.session_id}`)}
                                                                        className="text-[11px] text-agora-text-muted hover:text-indigo-300 transition-colors truncate text-left max-w-full"
                                                                        title={copy.session_title}
                                                                    >
                                                                        {copy.session_title}
                                                                    </button>
                                                                ) : (
                                                                    <span className="text-[11px] text-agora-text-muted/40 italic">
                                                                        Untitled debate
                                                                    </span>
                                                                )}
                                                                <div className="text-[10px] text-agora-text-muted/50 mt-0.5">
                                                                    {formatRelativeTime(copy.created_at)}
                                                                </div>
                                                            </div>

                                                            <span className={cn(
                                                                "shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border",
                                                                STATUS_STYLES[copy.status] ?? STATUS_STYLES.uploaded,
                                                            )}>
                                                                {copy.status}
                                                            </span>

                                                            {/* Open this specific copy */}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpen(copy)}
                                                                disabled={opening === copy.id}
                                                                className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity p-1.5 rounded-lg text-agora-text-muted hover:text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
                                                                title="Open file"
                                                            >
                                                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                                                    <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h10a1 1 0 001-1v-3M9 2h5v5M14 2L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            </button>

                                                            {/* Delete this specific copy */}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDelete(copy)}
                                                                disabled={deleting === copy.id}
                                                                className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity p-1.5 rounded-lg text-agora-text-muted hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                                                                title="Remove from this debate"
                                                            >
                                                                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                                                                    <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
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
                    </>
                )}
            </div>

        </div>
    );
}
