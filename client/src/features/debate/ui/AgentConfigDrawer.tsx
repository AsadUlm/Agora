import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router-dom";
import type { AgentConfig } from "../model/agent-config.types";
import {
    AGENT_PRESETS,
    createAgentConfig,
    createAgentFromPreset,
} from "../model/agent-config.types";
import AgentConfigCard from "./AgentConfigCard";
import type { DocumentItem } from "./AgentConfigCard";
import DocumentUploadPanel from "./DocumentUploadPanel";
import type { DocumentDTO, DocumentUploadFailureDTO } from "../api/debate.types";
import {
    useAgentPresets,
    useAgentPresetCache,
} from "@/features/agent-presets/model/useAgentPresets";
import {
    applyPresetToAgentConfig,
    type AgentPreset as BackendAgentPreset,
    type AgentPresetCreatePayload,
} from "@/features/agent-presets/model/agent-preset.types";
import { createAgentPreset } from "@/features/agent-presets/api/agent-preset.api";
import AgentPresetFormModal from "@/features/agent-presets/ui/AgentPresetFormModal";
import { toast } from "@/shared/ui/toast";

interface AgentConfigDrawerProps {
    open: boolean;
    onClose: () => void;
    agents: AgentConfig[];
    onUpdate: (id: string, updates: Partial<AgentConfig>) => void;
    onRemove: (id: string) => void;
    onAdd: (agent?: AgentConfig) => void;
    onMove: (id: string, direction: "up" | "down") => void;
    documents?: DocumentItem[];
    rawDocuments?: DocumentDTO[];
    uploading?: boolean;
    onUploadDocument?: (file: File) => Promise<void>;
    /** Step 30: batch upload variant. When provided, the panel uses it. */
    onUploadDocumentsBatch?: (files: File[]) => Promise<DocumentUploadFailureDTO[] | void>;
    onDeleteDocument?: (documentId: string) => void;
}

export default function AgentConfigDrawer({
    open,
    onClose,
    agents,
    onUpdate,
    onRemove,
    onAdd,
    onMove,
    documents = [],
    rawDocuments = [],
    uploading = false,
    onUploadDocument,
    onUploadDocumentsBatch,
    onDeleteDocument,
}: AgentConfigDrawerProps) {
    const enabledCount = agents.filter((a) => a.enabled).length;
    const navigate = useNavigate();

    // ── Preset catalog (system + user) ────────────────────────────────
    const { presets, loading: presetsLoading, error: presetsError, refresh: refreshPresets } =
        useAgentPresets();
    const upsertPresetCache = useAgentPresetCache((s) => s.upsert);

    // Refetch every time the drawer opens so newly-created presets show up
    // without requiring an app reload.
    useEffect(() => {
        if (open) {
            refreshPresets();
        }
    }, [open, refreshPresets]);

    const systemPresets = useMemo(
        () => presets.filter((p) => p.type === "system"),
        [presets],
    );
    const userPresets = useMemo(
        () => presets.filter((p) => p.type === "user"),
        [presets],
    );

    // Backend may be unavailable — fall back to local hardcoded list so
    // system presets remain usable.
    const hasBackendSystem = systemPresets.length > 0;

    // ── Preset menu open/close state ──────────────────────────────────
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);
    const presetMenuRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!presetMenuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
                setPresetMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [presetMenuOpen]);

    // ── Save Current as Preset modal ──────────────────────────────────
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const canSaveCurrent = agents.length > 0;
    // Use the most recently configured agent as the source for "Save as Preset".
    const sourceAgent: AgentConfig | null = canSaveCurrent
        ? agents[agents.length - 1]
        : null;

    const sourceAgentAsPreset: BackendAgentPreset | null = useMemo(() => {
        if (!sourceAgent) return null;
        return {
            id: "",
            name: sourceAgent.role || "My Preset",
            description: null,
            type: "user",
            visibility: "private",
            role_description: sourceAgent.roleDescription ?? "",
            reasoning_style: sourceAgent.reasoningStyle ?? "balanced",
            reasoning_depth: sourceAgent.reasoningDepth ?? "normal",
            provider: sourceAgent.provider ?? "openrouter",
            model: sourceAgent.model ?? "anthropic/claude-sonnet-4.5",
            model_preset: sourceAgent.modelPreset ?? null,
            temperature: sourceAgent.temperature ?? 0.7,
            rag_mode: sourceAgent.knowledgeMode ?? "shared_session_docs",
            document_ids: [...(sourceAgent.documentIds ?? [])],
            strict_grounding: sourceAgent.knowledgeStrict ?? false,
        };
    }, [sourceAgent]);

    const handleSaveCurrentPreset = async (payload: AgentPresetCreatePayload) => {
        try {
            const created = await createAgentPreset(payload);
            upsertPresetCache(created);
            toast.success(`Preset "${created.name}" saved.`);
        } catch {
            toast.error("Failed to save preset.");
            throw new Error("save failed"); // let the modal stay open
        }
    };

    // ── Preset selection → add agent ──────────────────────────────────
    const addAgentFromBackendPreset = (preset: BackendAgentPreset) => {
        const base = createAgentConfig({ role: preset.name });
        const updates = applyPresetToAgentConfig(preset, base, { overrideRole: true });
        const merged: AgentConfig = { ...base, ...updates, enabled: true };
        onAdd(merged);
        setPresetMenuOpen(false);
    };

    const addAgentFromLocalPreset = (key: string) => {
        const p = AGENT_PRESETS.find((x) => x.key === key);
        if (!p) return;
        onAdd(createAgentFromPreset(p));
        setPresetMenuOpen(false);
    };

    const handleManagePresets = () => {
        setPresetMenuOpen(false);
        onClose();
        navigate("/agent-presets");
    };

    return (
        <>
            <AnimatePresence>
                {open && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                            onClick={onClose}
                        />

                        {/* Drawer */}
                        <motion.div
                            initial={{ x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "-100%" }}
                            transition={{ type: "spring", damping: 28, stiffness: 300 }}
                            className="fixed left-0 top-0 bottom-0 w-[48vw] max-w-[700px] min-w-[380px] bg-agora-bg border-r border-agora-border z-50 flex flex-col shadow-2xl shadow-black/40"
                        >
                            {/* Header */}
                            <div className="px-6 py-5 border-b border-agora-border flex items-center justify-between shrink-0">
                                <div>
                                    <h2 className="text-sm font-semibold text-white">
                                        Agent Configuration
                                    </h2>
                                    <p className="text-[11px] text-agora-text-muted mt-0.5">
                                        {enabledCount} of {agents.length} agents enabled
                                    </p>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-lg hover:bg-agora-surface-light text-agora-text-muted hover:text-white transition-colors"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>

                            {/* Agent list */}
                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                                {/* Document Management Section */}
                                {(onUploadDocument || onUploadDocumentsBatch) && (
                                    <div className="mb-4 pb-4 border-b border-agora-border/30">
                                        <h3 className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-3 flex items-center gap-2">
                                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                                <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                                                <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                                            </svg>
                                            Session Documents
                                        </h3>
                                        <DocumentUploadPanel
                                            documents={rawDocuments}
                                            uploading={uploading}
                                            onUpload={onUploadDocument}
                                            onUploadBatch={onUploadDocumentsBatch}
                                            onDelete={onDeleteDocument ?? (() => { })}
                                        />
                                    </div>
                                )}

                                {agents.map((agent, idx) => (
                                    <AgentConfigCard
                                        key={agent._id}
                                        agent={agent}
                                        index={idx}
                                        total={agents.length}
                                        onUpdate={(updates) =>
                                            onUpdate(agent._id, updates)
                                        }
                                        onRemove={() => onRemove(agent._id)}
                                        onMoveUp={() => onMove(agent._id, "up")}
                                        onMoveDown={() => onMove(agent._id, "down")}
                                        documents={documents}
                                    />
                                ))}

                                {agents.length === 0 && (
                                    <div className="text-center py-12">
                                        <p className="text-agora-text-muted text-sm">
                                            No agents configured. Add one to begin.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-agora-border shrink-0 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => onAdd()}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border border-dashed border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/40 transition-all"
                                    >
                                        <span className="text-base leading-none">+</span>
                                        Add Agent
                                    </button>
                                    <div className="relative" ref={presetMenuRef}>
                                        <button
                                            type="button"
                                            onClick={() => setPresetMenuOpen((v) => !v)}
                                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/40 transition-all"
                                        >
                                            <span className="text-[10px]">⚡</span>
                                            Preset
                                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                                        </button>
                                        <AnimatePresence>
                                            {presetMenuOpen && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 4 }}
                                                    transition={{ duration: 0.12 }}
                                                    className="absolute bottom-full left-0 mb-1 w-72 max-h-[60vh] overflow-y-auto bg-agora-surface border border-agora-border rounded-lg shadow-xl z-20"
                                                >
                                                    {/* ── System Presets ─────────────────── */}
                                                    <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-indigo-400/80 font-semibold">
                                                        System Presets
                                                    </div>
                                                    {hasBackendSystem ? (
                                                        systemPresets.map((p) => (
                                                            <button
                                                                key={p.id}
                                                                onClick={() => addAgentFromBackendPreset(p)}
                                                                className="w-full text-left px-3 py-2 hover:bg-agora-surface-light/50 transition-colors flex items-start gap-2"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs font-medium text-white truncate">
                                                                            {p.name}
                                                                        </span>
                                                                        <span className="text-[9px] px-1 py-px rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                                                                            System
                                                                        </span>
                                                                    </div>
                                                                    {p.role_description && (
                                                                        <p className="text-[10px] text-agora-text-muted mt-0.5 truncate">
                                                                            {p.role_description}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </button>
                                                        ))
                                                    ) : (
                                                        // Backend unavailable → fall back to local hardcoded list.
                                                        AGENT_PRESETS.map((p) => (
                                                            <button
                                                                key={p.key}
                                                                onClick={() => addAgentFromLocalPreset(p.key)}
                                                                className="w-full text-left px-3 py-2 hover:bg-agora-surface-light/50 transition-colors flex items-start gap-2"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs font-medium text-white truncate">
                                                                            {p.label}
                                                                        </span>
                                                                        <span className="text-[9px] px-1 py-px rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                                                                            System
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[10px] text-agora-text-muted mt-0.5 truncate">
                                                                        {p.role}
                                                                    </p>
                                                                </div>
                                                            </button>
                                                        ))
                                                    )}

                                                    {/* ── My Presets ─────────────────────── */}
                                                    <div className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-widest text-violet-400/80 font-semibold border-t border-agora-border/40 mt-1">
                                                        My Presets
                                                    </div>
                                                    {presetsLoading && userPresets.length === 0 ? (
                                                        <div className="px-3 py-2 text-[11px] text-agora-text-muted italic">
                                                            Loading presets…
                                                        </div>
                                                    ) : presetsError && userPresets.length === 0 ? (
                                                        <div className="px-3 py-2 text-[11px] text-rose-300/80 italic">
                                                            Failed to load presets
                                                        </div>
                                                    ) : userPresets.length === 0 ? (
                                                        <div className="px-3 py-2 text-[11px] text-agora-text-muted italic opacity-60 cursor-not-allowed select-none">
                                                            No custom presets yet
                                                        </div>
                                                    ) : (
                                                        userPresets.map((p) => (
                                                            <button
                                                                key={p.id}
                                                                onClick={() => addAgentFromBackendPreset(p)}
                                                                className="w-full text-left px-3 py-2 hover:bg-agora-surface-light/50 transition-colors flex items-start gap-2"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs font-medium text-white truncate">
                                                                            {p.name}
                                                                        </span>
                                                                        <span className="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-300 border border-violet-500/20">
                                                                            Custom
                                                                        </span>
                                                                    </div>
                                                                    {(p.description || p.role_description) && (
                                                                        <p className="text-[10px] text-agora-text-muted mt-0.5 truncate">
                                                                            {p.description || p.role_description}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </button>
                                                        ))
                                                    )}

                                                    {/* ── Actions ────────────────────────── */}
                                                    <div className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-widest text-agora-text-muted font-semibold border-t border-agora-border/40 mt-1">
                                                        Actions
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            if (!canSaveCurrent) return;
                                                            setPresetMenuOpen(false);
                                                            setSaveAsOpen(true);
                                                        }}
                                                        disabled={!canSaveCurrent}
                                                        className="w-full text-left px-3 py-2 text-xs text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-agora-text-muted"
                                                    >
                                                        💾  Save Current as Preset
                                                    </button>
                                                    <button
                                                        onClick={handleManagePresets}
                                                        className="w-full text-left px-3 py-2 text-xs text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 transition-colors rounded-b-lg"
                                                    >
                                                        ⚙  Manage Presets
                                                    </button>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                                >
                                    Done
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Save Current as Preset — rendered outside the drawer so it stays
            visible if the drawer animates. */}
            <AgentPresetFormModal
                open={saveAsOpen}
                onClose={() => setSaveAsOpen(false)}
                initial={sourceAgentAsPreset}
                submitLabel="Save Preset"
                onSubmit={handleSaveCurrentPreset}
            />
        </>
    );
}
