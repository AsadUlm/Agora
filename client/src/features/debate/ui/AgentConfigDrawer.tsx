import { motion, AnimatePresence } from "motion/react";
import type { AgentConfig } from "../model/agent-config.types";
import { AGENT_PRESETS, createAgentFromPreset } from "../model/agent-config.types";
import AgentConfigCard from "./AgentConfigCard";
import type { DocumentItem } from "./AgentConfigCard";
import DocumentUploadPanel from "./DocumentUploadPanel";
import type { DocumentDTO } from "../api/debate.types";

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
    onDeleteDocument,
}: AgentConfigDrawerProps) {
    const enabledCount = agents.filter((a) => a.enabled).length;

    return (
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
                            {onUploadDocument && (
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
                                <div className="relative group">
                                    <button
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/40 transition-all"
                                    >
                                        <span className="text-[10px]">⚡</span>
                                        Preset
                                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                                    </button>
                                    <div className="absolute bottom-full left-0 mb-1 w-52 bg-agora-surface border border-agora-border rounded-lg shadow-xl invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all z-10">
                                        {AGENT_PRESETS.map((p) => (
                                            <button
                                                key={p.key}
                                                onClick={() => onAdd(createAgentFromPreset(p.key))}
                                                className="w-full text-left px-3 py-2 text-xs text-agora-text-muted hover:text-white hover:bg-agora-surface-light/50 first:rounded-t-lg last:rounded-b-lg transition-colors"
                                            >
                                                <span className="font-medium text-white">{p.label}</span>
                                                <span className="block text-[10px] mt-0.5 text-agora-text-muted">{p.role}</span>
                                            </button>
                                        ))}
                                    </div>
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
    );
}
