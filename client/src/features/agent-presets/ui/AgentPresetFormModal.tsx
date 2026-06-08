/**
 * Reusable create/edit form for an Agent Preset. Renders as a centered
 * modal. Self-contained — fetches its own document list lazily when the
 * user picks the "assigned documents" RAG mode.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/shared/lib/cn";
import { useLLMCatalog } from "@/features/debate/model/useLLMCatalog";
import {
    KNOWLEDGE_MODES,
    MODEL_OPTIONS,
    MODEL_PRESETS,
    PROVIDER_OPTIONS,
    REASONING_DEPTHS,
    REASONING_STYLES,
} from "@/features/debate/model/agent-config.types";
import { listAllDocuments } from "@/features/debate/api/debate.api";
import type { DocumentAllItemDTO } from "@/features/debate/api/debate.types";
import type {
    AgentPreset,
    AgentPresetCreatePayload,
} from "../model/agent-preset.types";

interface AgentPresetFormModalProps {
    open: boolean;
    onClose: () => void;
    initial?: AgentPreset | null;
    submitLabel?: string;
    onSubmit: (payload: AgentPresetCreatePayload) => Promise<void>;
}

interface FormState {
    name: string;
    description: string;
    role_description: string;
    reasoning_style: string;
    reasoning_depth: string;
    provider: string;
    model: string;
    model_preset: string | null;
    temperature: number;
    rag_mode: AgentPresetCreatePayload["rag_mode"];
    document_ids: string[];
    strict_grounding: boolean;
    is_default: boolean;
}

function presetToForm(p: AgentPreset | null | undefined): FormState {
    return {
        name: p?.name ?? "",
        description: p?.description ?? "",
        role_description: p?.role_description ?? "",
        reasoning_style: p?.reasoning_style ?? "balanced",
        reasoning_depth: p?.reasoning_depth ?? "normal",
        provider: p?.provider ?? "openrouter",
        model: p?.model ?? "anthropic/claude-sonnet-4.5",
        model_preset: (p?.model_preset as string | null) ?? "balanced",
        temperature: p?.temperature ?? 0.7,
        rag_mode: p?.rag_mode ?? "shared_session_docs",
        document_ids: [...(p?.document_ids ?? [])],
        strict_grounding: p?.strict_grounding ?? false,
        is_default: p?.is_default ?? false,
    };
}

export default function AgentPresetFormModal({
    open,
    onClose,
    initial,
    submitLabel = "Save",
    onSubmit,
}: AgentPresetFormModalProps) {
    const [form, setForm] = useState<FormState>(() => presetToForm(initial));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [allDocs, setAllDocs] = useState<DocumentAllItemDTO[]>([]);

    const { providers: catalog } = useLLMCatalog();

    const providerIds = useMemo(
        () => (Array.isArray(catalog) && catalog.length
            ? catalog.filter((p) => p.status !== "placeholder").map((p) => p.id)
            : [...PROVIDER_OPTIONS]),
        [catalog],
    );

    const modelMap = useMemo<Record<string, { id: string; name: string }[]>>(
        () => (Array.isArray(catalog) && catalog.length
            ? Object.fromEntries(
                catalog.map((p) => [p.id, p.models.map((m) => ({ id: m.id, name: m.name }))]),
            )
            : Object.fromEntries(
                Object.entries(MODEL_OPTIONS).map(([k, ids]) => [
                    k,
                    ids.map((id) => ({ id, name: id })),
                ]),
            )),
        [catalog],
    );

    const models = modelMap[form.provider] ?? modelMap.openrouter ?? [];

    useEffect(() => {
        if (open) {
            setForm(presetToForm(initial));
            setDirty(false);
            setError(null);
        }
    }, [open, initial]);

    useEffect(() => {
        if (open && form.rag_mode === "assigned_docs_only" && allDocs.length === 0) {
            listAllDocuments().then(setAllDocs).catch(() => {/* ignore */ });
        }
    }, [open, form.rag_mode, allDocs.length]);

    const update = (patch: Partial<FormState>) => {
        setForm((prev) => ({ ...prev, ...patch }));
        setDirty(true);
    };

    const handleClose = () => {
        if (dirty && !confirm("Discard unsaved changes?")) return;
        onClose();
    };

    const handleSubmit = async () => {
        setError(null);
        if (!form.name.trim()) {
            setError("Name is required.");
            return;
        }
        if (!form.role_description.trim()) {
            setError("Role description is required.");
            return;
        }
        setSaving(true);
        try {
            await onSubmit({
                name: form.name.trim(),
                description: form.description.trim() || null,
                role_description: form.role_description.trim(),
                reasoning_style: form.reasoning_style,
                reasoning_depth: form.reasoning_depth,
                provider: form.provider,
                model: form.model,
                model_preset: form.model_preset,
                temperature: form.temperature,
                rag_mode: form.rag_mode,
                document_ids: form.rag_mode === "assigned_docs_only" ? form.document_ids : [],
                strict_grounding: form.strict_grounding,
                is_default: form.is_default,
            });
            setDirty(false);
            onClose();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            setError(msg ?? "Failed to save preset.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                        onClick={handleClose}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ duration: 0.18 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
                    >
                        <div className="pointer-events-auto w-full max-w-2xl max-h-[88vh] flex flex-col bg-agora-surface border border-agora-border rounded-2xl shadow-2xl">
                            {/* Header */}
                            <div className="px-6 py-4 border-b border-agora-border flex items-center justify-between shrink-0">
                                <div>
                                    <h2 className="text-sm font-semibold text-white">
                                        {initial ? "Edit Preset" : "Create Preset"}
                                    </h2>
                                    <p className="text-[11px] text-agora-text-muted mt-0.5">
                                        Reusable agent configuration template.
                                    </p>
                                </div>
                                <button
                                    onClick={handleClose}
                                    className="p-2 rounded-lg hover:bg-agora-surface-light text-agora-text-muted hover:text-white transition-colors"
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>

                            {/* Body */}
                            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                                {error && (
                                    <div className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-200">
                                        {error}
                                    </div>
                                )}

                                <Field label="Preset Name *">
                                    <input
                                        type="text"
                                        value={form.name}
                                        onChange={(e) => update({ name: e.target.value })}
                                        placeholder="e.g. Senior Policy Analyst"
                                        className="input"
                                    />
                                </Field>

                                <Field label="Description">
                                    <input
                                        type="text"
                                        value={form.description}
                                        onChange={(e) => update({ description: e.target.value })}
                                        placeholder="Short summary shown in lists"
                                        className="input"
                                    />
                                </Field>

                                <Field label="Role Description / Mission *">
                                    <textarea
                                        rows={4}
                                        value={form.role_description}
                                        onChange={(e) => update({ role_description: e.target.value })}
                                        placeholder="Describe what this agent does and how it argues..."
                                        className="input resize-y min-h-[72px]"
                                    />
                                </Field>

                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Reasoning Style">
                                        <select
                                            value={form.reasoning_style}
                                            onChange={(e) => update({ reasoning_style: e.target.value })}
                                            className="input"
                                        >
                                            {REASONING_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Reasoning Depth">
                                        <select
                                            value={form.reasoning_depth}
                                            onChange={(e) => update({ reasoning_depth: e.target.value })}
                                            className="input"
                                        >
                                            {REASONING_DEPTHS.map((d) => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    </Field>

                                    <Field label="Model Preset">
                                        <select
                                            value={form.model_preset ?? "custom"}
                                            onChange={(e) => {
                                                const key = e.target.value;
                                                if (key === "custom") {
                                                    update({ model_preset: null });
                                                    return;
                                                }
                                                const mp = MODEL_PRESETS.find((p) => p.key === key);
                                                if (mp) {
                                                    update({
                                                        model_preset: mp.key,
                                                        provider: mp.provider,
                                                        model: mp.model,
                                                        temperature: mp.temperature,
                                                    });
                                                }
                                            }}
                                            className="input"
                                        >
                                            <option value="custom">Custom</option>
                                            {MODEL_PRESETS.map((m) => (
                                                <option key={m.key} value={m.key}>{m.label}</option>
                                            ))}
                                        </select>
                                    </Field>

                                    <Field label="Provider">
                                        <select
                                            value={form.provider}
                                            onChange={(e) => {
                                                const provider = e.target.value;
                                                const newModels = modelMap[provider] ?? [];
                                                update({
                                                    provider,
                                                    model: newModels[0]?.id ?? form.model,
                                                    model_preset: null,
                                                });
                                            }}
                                            className="input"
                                        >
                                            {providerIds.map((p) => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                    </Field>

                                    <Field label="Model" className="col-span-2">
                                        <select
                                            value={form.model}
                                            onChange={(e) => update({ model: e.target.value, model_preset: null })}
                                            className="input"
                                        >
                                            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                    </Field>

                                    <Field label={`Temperature: ${form.temperature.toFixed(1)}`} className="col-span-2">
                                        <input
                                            type="range"
                                            min={0}
                                            max={2}
                                            step={0.1}
                                            value={form.temperature}
                                            onChange={(e) =>
                                                update({ temperature: parseFloat(e.target.value), model_preset: null })
                                            }
                                            className="w-full h-1.5 bg-agora-border rounded-full appearance-none cursor-pointer accent-indigo-500"
                                        />
                                    </Field>
                                </div>

                                {/* RAG */}
                                <div className="pt-2 border-t border-agora-border/30">
                                    <h4 className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-2">
                                        Knowledge / RAG
                                    </h4>
                                    <div className="space-y-1.5">
                                        {KNOWLEDGE_MODES.map((km) => (
                                            <label
                                                key={km.value}
                                                className={cn(
                                                    "flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-all",
                                                    form.rag_mode === km.value
                                                        ? "border-indigo-500/50 bg-indigo-500/5"
                                                        : "border-agora-border/30 hover:border-agora-border",
                                                )}
                                            >
                                                <input
                                                    type="radio"
                                                    name="rag-mode"
                                                    checked={form.rag_mode === km.value}
                                                    onChange={() => update({ rag_mode: km.value })}
                                                    className="mt-0.5 accent-indigo-500"
                                                />
                                                <div>
                                                    <div className="text-xs text-white font-medium">{km.label}</div>
                                                    <div className="text-[10px] text-agora-text-muted">{km.description}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>

                                    {form.rag_mode === "assigned_docs_only" && (
                                        <div className="mt-3">
                                            <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                                                Assigned Documents
                                                {form.document_ids.length > 0 && (
                                                    <span className="ml-2 text-indigo-400">
                                                        ({form.document_ids.length} selected)
                                                    </span>
                                                )}
                                            </label>
                                            {allDocs.length === 0 ? (
                                                <div className="px-3 py-3 rounded-lg border border-dashed border-agora-border/50 text-center">
                                                    <p className="text-[10px] text-agora-text-muted">
                                                        No documents found. Upload some on the Documents page first.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                                                    {allDocs.map((d) => {
                                                        const selected = form.document_ids.includes(d.id);
                                                        return (
                                                            <label
                                                                key={d.id}
                                                                className={cn(
                                                                    "flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-all",
                                                                    selected
                                                                        ? "border-indigo-500/50 bg-indigo-500/5 text-white"
                                                                        : "border-agora-border/30 text-agora-text-muted hover:border-agora-border",
                                                                )}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selected}
                                                                    onChange={(e) => {
                                                                        const ids = e.target.checked
                                                                            ? [...form.document_ids, d.id]
                                                                            : form.document_ids.filter((x) => x !== d.id);
                                                                        update({ document_ids: ids });
                                                                    }}
                                                                    className="accent-indigo-500"
                                                                />
                                                                <span className="truncate flex-1">{d.filename}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {form.rag_mode !== "no_docs" && (
                                        <label className="mt-3 flex items-center gap-2 cursor-pointer">
                                            <button
                                                type="button"
                                                onClick={() => update({ strict_grounding: !form.strict_grounding })}
                                                className={cn(
                                                    "w-9 h-5 rounded-full transition-colors relative",
                                                    form.strict_grounding ? "bg-indigo-600" : "bg-gray-600",
                                                )}
                                            >
                                                <div
                                                    className={cn(
                                                        "w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all",
                                                        form.strict_grounding ? "left-[18px]" : "left-[3px]",
                                                    )}
                                                />
                                            </button>
                                            <span className="text-xs text-white">Strict grounding</span>
                                            <span className="text-[10px] text-agora-text-muted">
                                                Only use provided documents
                                            </span>
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-agora-border flex items-center justify-end gap-2 shrink-0">
                                <button
                                    onClick={handleClose}
                                    className="px-4 py-2 rounded-lg text-xs font-medium text-agora-text-muted hover:text-white hover:bg-agora-surface-light/40 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={saving}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                                >
                                    {saving ? "Saving..." : submitLabel}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

function Field({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={className}>
            <label className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1 block">
                {label}
            </label>
            {children}
        </div>
    );
}
