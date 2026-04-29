import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/shared/lib/cn";
import type { DocumentDTO } from "../api/debate.types";

interface DocumentUploadPanelProps {
    documents: DocumentDTO[];
    uploading: boolean;
    onUpload: (file: File) => Promise<void>;
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
};

export default function DocumentUploadPanel({
    documents,
    uploading,
    onUpload,
    onDelete,
}: DocumentUploadPanelProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFile = async (file: File) => {
        setError(null);
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!ext || !["pdf", "txt", "docx"].includes(ext)) {
            setError(`File type .${ext} not supported. Use .pdf, .txt, or .docx`);
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            setError("File exceeds 20 MB limit.");
            return;
        }
        try {
            await onUpload(file);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            setError(msg);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
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
                    accept=".pdf,.txt,.docx"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(file);
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
                            Drop file or <span className="text-indigo-400">browse</span>
                        </p>
                        <p className="text-[10px] text-agora-text-muted/60 mt-0.5">
                            PDF, TXT, DOCX — max 20 MB
                        </p>
                    </div>
                )}
            </div>

            {/* Error */}
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
