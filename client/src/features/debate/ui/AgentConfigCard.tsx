import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/shared/lib/cn";
import type { AgentConfig } from "../model/agent-config.types";
import {
    MODEL_OPTIONS,
    PROVIDER_OPTIONS,
    REASONING_STYLES,
    REASONING_DEPTHS,
    KNOWLEDGE_MODES,
    AGENT_PRESETS,
} from "../model/agent-config.types";
import { useLLMCatalog } from "../model/useLLMCatalog";

export interface DocumentItem {
    id: string;
    filename: string;
    status: string;
}

interface AgentConfigCardProps {
    agent: AgentConfig;
    index: number;
    total: number;
    documents?: DocumentItem[];
    onUpdate: (updates: Partial<AgentConfig>) => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
}

export default function AgentConfigCard({
    agent,
    index,
    total,
    documents = [],
    onUpdate,
    onRemove,
    onMoveUp,
    onMoveDown,
}: AgentConfigCardProps) {
    const [expanded, setExpanded] = useState(false);
    const { providers: catalog } = useLLMCatalog();

    // Build provider/model lookups from the live catalog with a static fallback.
    const providerIds: string[] = catalog.length
        ? catalog.filter((p) => p.status !== "placeholder").map((p) => p.id)
        : [...PROVIDER_OPTIONS];
    const modelMap: Record<string, { id: string; name: string }[]> = catalog.length
        ? Object.fromEntries(
            catalog.map((p) => [p.id, p.models.map((m) => ({ id: m.id, name: m.name }))]),
        )
        : Object.fromEntries(
            Object.entries(MODEL_OPTIONS).map(([k, ids]) => [
                k,
                ids.map((id) => ({ id, name: id })),
            ]),
        );
    const models = modelMap[agent.provider] ?? modelMap.openrouter ?? [];

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
                "rounded-xl border transition-all",
                agent.enabled
                    ? "border-agora-border bg-agora-surface"
                    : "border-agora-border/50 bg-agora-surface/30 opacity-60",
            )}
        >
            {/* Card header */}
            <div className="px-4 py-3 flex items-center gap-3">
                {/* Reorder controls */}
                <div className="flex flex-col gap-0.5">
                    <button
                        onClick={onMoveUp}
                        disabled={index === 0}
                        className="text-agora-text-muted hover:text-white disabled:opacity-20 transition-colors p-0.5"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 3L10 7H2L6 3Z" fill="currentColor" />
                        </svg>
                    </button>
                    <button
                        onClick={onMoveDown}
                        disabled={index === total - 1}
                        className="text-agora-text-muted hover:text-white disabled:opacity-20 transition-colors p-0.5"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 9L2 5H10L6 9Z" fill="currentColor" />
                        </svg>
                    </button>
                </div>

                {/* Role badge */}
                <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400 text-xs font-bold uppercase">
                    {agent.role[0]}
                </div>

                {/* Role input */}
                <input
                    type="text"
                    value={agent.role}
                    onChange={(e) => onUpdate({ role: e.target.value })}
                    className="flex-1 bg-transparent text-sm font-medium text-white focus:outline-none border-b border-transparent focus:border-agora-border transition-colors"
                    placeholder="Agent role"
                />

                {/* Toggle enabled */}
                <button
                    onClick={() => onUpdate({ enabled: !agent.enabled })}
                    className={cn(
                        "w-9 h-5 rounded-full transition-colors relative",
                        agent.enabled ? "bg-indigo-600" : "bg-gray-600",
                    )}
                >
                    <div
                        className={cn(
                            "w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all",
                            agent.enabled ? "left-[18px]" : "left-[3px]",
                        )}
                    />
                </button>

                {/* Expand/collapse */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="p-1 text-agora-text-muted hover:text-white transition-colors"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        className={cn(
                            "transition-transform",
                            expanded ? "rotate-180" : "",
                        )}
                    >
                        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>

                {/* Remove */}
                <button
                    onClick={onRemove}
                    className="p-1 text-agora-text-muted hover:text-red-400 transition-colors"
                    title="Remove agent"
                >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                </button>
            </div>

            {/* Expanded settings */}
            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                        className="border-t border-agora-border/50"
                    >
                        <div className="px-4 pb-4 pt-1">
                            {/* Preset selector */}
                            <div className="mt-3 mb-3">
                                <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                    Preset
                                </label>
                                <select
                                    value={agent.preset ?? "custom"}
                                    onChange={(e) => {
                                        const key = e.target.value;
                                        if (key === "custom") {
                                            onUpdate({ preset: null });
                                            return;
                                        }
                                        const preset = AGENT_PRESETS.find((p) => p.key === key);
                                        if (preset) {
                                            onUpdate({
                                                preset: preset.key,
                                                role: preset.role,
                                                roleDescription: preset.roleDescription,
                                                reasoningStyle: preset.reasoningStyle,
                                                reasoningDepth: preset.reasoningDepth,
                                                knowledgeMode: preset.knowledgeMode,
                                                knowledgeStrict: preset.knowledgeStrict,
                                            });
                                        }
                                    }}
                                    className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                                >
                                    <option value="custom">Custom</option>
                                    {AGENT_PRESETS.map((p) => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Role description */}
                            <div className="mb-3">
                                <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                    Role Description / Mission
                                </label>
                                <textarea
                                    value={agent.roleDescription}
                                    onChange={(e) => onUpdate({ roleDescription: e.target.value, preset: null })}
                                    placeholder="Describe the agent's role and mission..."
                                    rows={2}
                                    className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {/* Reasoning Style */}
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                        Reasoning Style
                                    </label>
                                    <select
                                        value={agent.reasoningStyle}
                                        onChange={(e) =>
                                            onUpdate({ reasoningStyle: e.target.value, preset: null })
                                        }
                                        className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                                    >
                                        {REASONING_STYLES.map((s) => (
                                            <option key={s} value={s}>
                                                {s}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Reasoning Depth */}
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                        Reasoning Depth
                                    </label>
                                    <select
                                        value={agent.reasoningDepth}
                                        onChange={(e) =>
                                            onUpdate({ reasoningDepth: e.target.value, preset: null })
                                        }
                                        className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                                    >
                                        {REASONING_DEPTHS.map((d) => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Provider */}
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                        Provider
                                    </label>
                                    <select
                                        value={agent.provider}
                                        onChange={(e) => {
                                            const provider = e.target.value;
                                            const newModels = modelMap[provider] ?? [];
                                            onUpdate({
                                                provider,
                                                model: newModels[0]?.id ?? agent.model,
                                            });
                                        }}
                                        className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                                    >
                                        {providerIds.map((p) => (
                                            <option key={p} value={p}>
                                                {p}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Model */}
                                <div>
                                    <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                        Model
                                    </label>
                                    <select
                                        value={agent.model}
                                        onChange={(e) => onUpdate({ model: e.target.value })}
                                        className="w-full bg-agora-bg border border-agora-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                                    >
                                        {models.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Temperature */}
                                <div className="col-span-2">
                                    <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                        Temperature: {agent.temperature.toFixed(1)}
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.1"
                                        value={agent.temperature}
                                        onChange={(e) =>
                                            onUpdate({
                                                temperature: parseFloat(e.target.value),
                                            })
                                        }
                                        className="w-full h-1.5 bg-agora-border rounded-full appearance-none cursor-pointer accent-indigo-500"
                                    />
                                    <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                                        <span>Precise</span>
                                        <span>Creative</span>
                                    </div>
                                </div>
                            </div>

                            {/* Knowledge Settings */}
                            <div className="mt-4 pt-3 border-t border-agora-border/30">
                                <h4 className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-2">
                                    Knowledge / RAG
                                </h4>

                                {/* Knowledge Mode */}
                                <div className="space-y-1.5 mb-3">
                                    {KNOWLEDGE_MODES.map((km) => (
                                        <label
                                            key={km.value}
                                            className={cn(
                                                "flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all",
                                                agent.knowledgeMode === km.value
                                                    ? "border-indigo-500/50 bg-indigo-500/5"
                                                    : "border-agora-border/30 hover:border-agora-border",
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name={`knowledge-${agent._id}`}
                                                checked={agent.knowledgeMode === km.value}
                                                onChange={() => onUpdate({ knowledgeMode: km.value, preset: null })}
                                                className="mt-0.5 accent-indigo-500"
                                            />
                                            <div>
                                                <div className="text-xs text-white font-medium">{km.label}</div>
                                                <div className="text-[10px] text-agora-text-muted">{km.description}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>

                                {/* Document assignment (only for assigned_docs_only) */}
                                {agent.knowledgeMode === "assigned_docs_only" && (
                                    <div className="mb-3">
                                        <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                            Assigned Documents
                                            {agent.documentIds.length > 0 && (
                                                <span className="ml-2 text-indigo-400">
                                                    ({agent.documentIds.length} selected)
                                                </span>
                                            )}
                                        </label>
                                        {documents.length === 0 ? (
                                            <div className="px-3 py-3 rounded-lg border border-dashed border-agora-border/50 bg-agora-bg/30 text-center">
                                                <p className="text-[10px] text-agora-text-muted">
                                                    No documents uploaded yet.
                                                </p>
                                                <p className="text-[10px] text-indigo-400/80 mt-1">
                                                    Upload documents in the panel above to enable assignment.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                {documents.length > 2 && (
                                                    <button
                                                        onClick={() => {
                                                            const allSelected = documents.every((d) =>
                                                                agent.documentIds.includes(d.id),
                                                            );
                                                            onUpdate({
                                                                documentIds: allSelected
                                                                    ? []
                                                                    : documents
                                                                        .filter((d) => d.status === "ready")
                                                                        .map((d) => d.id),
                                                            });
                                                        }}
                                                        className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors mb-1"
                                                    >
                                                        {documents.every((d) => agent.documentIds.includes(d.id))
                                                            ? "Deselect all"
                                                            : "Select all ready"}
                                                    </button>
                                                )}
                                                {documents.map((doc) => {
                                                    const isReady = doc.status === "ready";
                                                    const isSelected = agent.documentIds.includes(doc.id);
                                                    const ext = doc.filename.split(".").pop()?.toLowerCase() ?? "";
                                                    const icon = ext === "pdf" ? "📄" : ext === "docx" ? "📋" : "📝";

                                                    return (
                                                        <label
                                                            key={doc.id}
                                                            className={cn(
                                                                "flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all",
                                                                !isReady && "opacity-50 cursor-not-allowed",
                                                                isSelected
                                                                    ? "border-indigo-500/50 bg-indigo-500/5 text-white"
                                                                    : "border-agora-border/30 text-agora-text-muted hover:border-agora-border",
                                                            )}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                disabled={!isReady}
                                                                onChange={(e) => {
                                                                    const ids = e.target.checked
                                                                        ? [...agent.documentIds, doc.id]
                                                                        : agent.documentIds.filter((id) => id !== doc.id);
                                                                    onUpdate({ documentIds: ids });
                                                                }}
                                                                className="accent-indigo-500"
                                                            />
                                                            <span className="text-sm shrink-0">{icon}</span>
                                                            <span className="truncate flex-1">{doc.filename}</span>
                                                            {!isReady && (
                                                                <span className={cn(
                                                                    "px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0",
                                                                    doc.status === "processing"
                                                                        ? "bg-amber-500/15 text-amber-400"
                                                                        : "bg-red-500/15 text-red-400",
                                                                )}>
                                                                    {doc.status}
                                                                </span>
                                                            )}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <p className="text-[9px] text-agora-text-muted/60 mt-1.5 italic">
                                            This agent will only use the selected documents as its knowledge base.
                                        </p>
                                    </div>
                                )}

                                {/* Strict grounding toggle */}
                                {agent.knowledgeMode !== "no_docs" && (
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <button
                                            onClick={() => onUpdate({ knowledgeStrict: !agent.knowledgeStrict, preset: null })}
                                            className={cn(
                                                "w-9 h-5 rounded-full transition-colors relative",
                                                agent.knowledgeStrict ? "bg-indigo-600" : "bg-gray-600",
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all",
                                                    agent.knowledgeStrict ? "left-[18px]" : "left-[3px]",
                                                )}
                                            />
                                        </button>
                                        <div>
                                            <span className="text-xs text-white">Strict grounding</span>
                                            <span className="text-[10px] text-agora-text-muted ml-1.5">
                                                Only use provided documents
                                            </span>
                                        </div>
                                    </label>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
