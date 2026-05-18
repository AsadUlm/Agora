import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/shared/lib/cn";
import type {
    DocumentDTO,
    DocumentUploadFailureDTO,
} from "../api/debate.types";

interface DocumentUploadPanelProps {
    documents: DocumentDTO[];
    uploading: boolean;
    /** Legacy single-file upload. Kept for backward compatibility. */
    onUpload?: (file: File) => Promise<void>;
    /**
     * Step 30: batch upload. When provided, the panel uses this for both
     * drag-and-drop and the file picker. Should resolve with the per-file
     * failures from the backend (uploaded items are appended via the parent's
     * `documents` prop).
     */
    onUploadBatch?: (files: File[]) => Promise<DocumentUploadFailureDTO[] | void>;
    onDelete: (documentId: string) => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
    ready: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Ready" },
    processing: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Processing" },
    uploaded: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Uploaded" },
    failed: { bg: "bg-red-500/15", text: "text-red-400", label: "Failed" },
};

const FILE_ICONS: Record<string, string> = {
    pdf: "📄",
    txt: "📝",
    docx: "📋",
    md: "📑",
    csv: "📊",
    json: "🧾",
};

const SUPPORTED_EXT = ["pdf", "txt", "docx", "md", "csv", "json"] as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

function formatBytes(n?: number | null): string {
    if (n == null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function DocumentUploadPanel({
    documents,
    uploading,
    onUpload,
    onUploadBatch,
    onDelete,
}: DocumentUploadPanelProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [failed, setFailed] = useState<DocumentUploadFailureDTO[]>([]);

    const validate = (files: File[]): { valid: File[]; rejected: DocumentUploadFailureDTO[] } => {
        const valid: File[] = [];
        const rejected: DocumentUploadFailureDTO[] = [];
        for (const file of files) {
            const ext = file.name.split(".").pop()?.toLowerCase();
            if (!ext || !(SUPPORTED_EXT as readonly string[]).includes(ext)) {
                rejected.push({ filename: file.name, error: `Unsupported type .${ext ?? "?"}` });
                continue;
            }
            if (file.size > MAX_BYTES) {
                rejected.push({ filename: file.name, error: "Exceeds 20 MB limit" });
                continue;
            }
            valid.push(file);
        }
        return { valid, rejected };
    };

    const handleFiles = async (incoming: File[]) => {
        setError(null);
        if (incoming.length === 0) return;
        if (incoming.length > MAX_FILES) {
            setError(`Up to ${MAX_FILES} files per upload.`);
            return;
        }
        const { valid, rejected } = validate(incoming);
        setFailed(rejected);

        if (valid.length === 0) return;

        try {
            if (onUploadBatch) {
                const serverFails = await onUploadBatch(valid);
                if (serverFails && serverFails.length) {
                    setFailed((prev) => [...prev, ...serverFails]);
                }
            } else if (onUpload) {
                // Fallback: legacy single-file path, sequential.
                for (const f of valid) {
                    try {
                        await onUpload(f);
                    } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : "Upload failed";
                        setFailed((prev) => [...prev, { filename: f.name, error: msg }]);
                    }
                }
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            setError(msg);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const list = Array.from(e.dataTransfer.files ?? []);
        if (list.length) handleFiles(list);
    };

    return (
        <div className="space-y-3">
            {/* Upload zone */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                    "border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all",
                    dragOver
                        ? "border-indigo-500/60 bg-indigo-500/5"
                        : "border-agora-border/60 hover:border-agora-border bg-agora-bg/50",
                    uploading && "opacity-50 pointer-events-none",
                )}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.docx,.md,.csv,.json"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        const list = Array.from(e.target.files ?? []);
                        if (list.length) handleFiles(list);
                        e.target.value = "";
                    }}
                />
                {uploading ? (
                    <div className="flex items-center justify-center gap-2 py-1">
                        <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                        <span className="text-xs text-agora-text-muted">Uploading...</span>
                    </div>
                ) : (
                    <div className="py-1">
                        <div className="text-lg mb-1">📎</div>
                        <p className="text-xs text-agora-text-muted">
                            Drop files or <span className="text-indigo-400">browse</span>
                        </p>
                        <p className="text-[10px] text-agora-text-muted/60 mt-0.5">
                            PDF, DOCX, TXT, MD, CSV, JSON — max 20 MB per file, up to {MAX_FILES} files
                        </p>
                    </div>
                )}
            </div>

            {/* Validation / general error */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between"
                    >
                        <span>{error}</span>
                        <button onClick={() => setError(null)} className="ml-2 text-red-400/60 hover:text-red-400">
                            ✕
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Per-file failures */}
            <AnimatePresence>
                {failed.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15 space-y-1"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-widest text-red-400/80 font-semibold">
                                Failed ({failed.length})
                            </span>
                            <button
                                onClick={() => setFailed([])}
                                className="text-[10px] text-red-400/60 hover:text-red-400"
                            >
                                clear
                            </button>
                        </div>
                        {failed.map((f, i) => (
                            <div key={`${f.filename}-${i}`} className="text-[11px] text-red-300/90 flex gap-2">
                                <span className="truncate flex-1">{f.filename}</span>
                                <span className="text-red-400/70 truncate">{f.error}</span>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Document list */}
            {documents.length > 0 && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                            Uploaded Documents ({documents.length})
                        </span>
                    </div>
                    <AnimatePresence>
                        {documents.map((doc) => {
                            const ext = doc.filename.split(".").pop()?.toLowerCase() ?? "";
                            const icon = FILE_ICONS[ext] ?? "📄";
                            const status = STATUS_STYLES[doc.status] ?? STATUS_STYLES.uploaded;

                            return (
                                <motion.div
                                    key={doc.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-agora-border/40 bg-agora-surface/50 group"
                                >
                                    <span className="text-sm shrink-0">{icon}</span>
                                    <span className="flex-1 text-xs text-white truncate">
                                        {doc.filename}
                                    </span>
                                    {doc.bytes != null && (
                                        <span className="text-[9px] text-agora-text-muted/70 shrink-0">
                                            {formatBytes(doc.bytes)}
                                        </span>
                                    )}
                                    {doc.storage_provider === "cloudinary" && (
                                        <span
                                            className="text-[9px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-300 shrink-0"
                                            title="Stored in Cloudinary"
                                        >
                                            ☁
                                        </span>
                                    )}
                                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0", status.bg, status.text)}>
                                        {status.label}
                                    </span>
                                    <button
                                        onClick={() => onDelete(doc.id)}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-agora-text-muted hover:text-red-400 transition-all"
                                        title="Remove document"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                        </svg>
                                    </button>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}

