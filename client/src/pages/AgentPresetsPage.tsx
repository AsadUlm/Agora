/**
 * Agent Presets management page.
 *
 *   /agent-presets
 *
 * Lets the user browse system + their own user presets and create / edit /
 * duplicate / delete user presets. A preset can also be "applied" — which
 * routes to the New Debate form with `?presetId=...` so the draft picks
 * it up and adds a new agent based on the preset.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/shared/lib/cn";
import { toast } from "@/shared/ui/toast";
import {
    createAgentPreset,
    deleteAgentPreset,
    duplicateAgentPreset,
    listAgentPresets,
    updateAgentPreset,
} from "@/features/agent-presets/api/agent-preset.api";
import type {
    AgentPreset,
    AgentPresetCreatePayload,
} from "@/features/agent-presets/model/agent-preset.types";
import { isSystemPreset } from "@/features/agent-presets/model/agent-preset.types";
import AgentPresetFormModal from "@/features/agent-presets/ui/AgentPresetFormModal";

type FilterTab = "all" | "user" | "system";
type SortKey = "updated" | "name";

export default function AgentPresetsPage() {
    const navigate = useNavigate();
    const [presets, setPresets] = useState<AgentPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [filter, setFilter] = useState<FilterTab>("all");
    const [sort, setSort] = useState<SortKey>("updated");
    const [editing, setEditing] = useState<AgentPreset | null>(null);
    const [creating, setCreating] = useState(false);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
        return () => clearTimeout(t);
    }, [search]);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const items = await listAgentPresets({ query: debouncedSearch || undefined });
            setPresets(Array.isArray(items) ? items : []);
        } catch {
            toast.error("Failed to load presets.");
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const filtered = useMemo(() => {
        let arr = presets;
        if (filter === "user") arr = arr.filter((p) => p.type === "user");
        if (filter === "system") arr = arr.filter((p) => p.type === "system");
        const copy = [...arr];
        if (sort === "name") {
            copy.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            copy.sort((a, b) => {
                const ad = a.updated_at ?? "";
                const bd = b.updated_at ?? "";
                return bd.localeCompare(ad);
            });
        }
        return copy;
    }, [presets, filter, sort]);

    const userPresetCount = presets.filter((p) => p.type === "user").length;

    const handleCreate = async (payload: AgentPresetCreatePayload) => {
        const created = await createAgentPreset(payload);
        setPresets((prev) => [created, ...prev]);
        toast.success("Preset created.");
    };

    const handleEdit = async (payload: AgentPresetCreatePayload) => {
        if (!editing) return;
        const updated = await updateAgentPreset(editing.id, payload);
        setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success("Preset updated.");
    };

    const handleDuplicate = async (preset: AgentPreset) => {
        try {
            const copy = await duplicateAgentPreset(preset.id);
            setPresets((prev) => [copy, ...prev]);
            toast.success(`Duplicated as "${copy.name}".`);
        } catch {
            toast.error("Failed to duplicate preset.");
        }
    };

    const handleDelete = async (preset: AgentPreset) => {
        if (preset.type === "system") return;
        if (!confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) return;
        try {
            await deleteAgentPreset(preset.id);
            setPresets((prev) => prev.filter((p) => p.id !== preset.id));
            toast.success("Preset deleted.");
        } catch {
            toast.error("Failed to delete preset.");
        }
    };

    const handleApply = (preset: AgentPreset) => {
        navigate(`/debates?presetId=${encodeURIComponent(preset.id)}`, {
            state: { openNew: true, presetId: preset.id },
        });
    };

    return (
        <div className="min-h-screen bg-agora-bg">
            <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
                {/* Header */}
                <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-xl font-semibold text-white">Agent Presets</h1>
                        <p className="text-xs text-agora-text-muted mt-1">
                            Create and manage reusable debate agent configurations.
                        </p>
                    </div>
                    <button
                        onClick={() => setCreating(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                    >
                        <span className="text-base leading-none">+</span> Create Preset
                    </button>
                </header>

                {/* Controls */}
                <div className="mb-5 flex flex-col md:flex-row md:items-center gap-3">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name, description, role..."
                        className="flex-1 bg-agora-surface border border-agora-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-agora-text-muted focus:outline-none focus:border-indigo-500/50"
                    />
                    <div className="flex items-center gap-1 bg-agora-surface border border-agora-border rounded-lg p-1">
                        {(["all", "user", "system"] as FilterTab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setFilter(tab)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors capitalize",
                                    filter === tab
                                        ? "bg-indigo-500/15 text-indigo-300"
                                        : "text-agora-text-muted hover:text-white",
                                )}
                            >
                                {tab === "user" ? "My Presets" : tab === "system" ? "System" : "All"}
                            </button>
                        ))}
                    </div>
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortKey)}
                        className="bg-agora-surface border border-agora-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50"
                    >
                        <option value="updated">Recently updated</option>
                        <option value="name">Name (A→Z)</option>
                    </select>
                </div>

                {/* List */}
                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="h-44 rounded-xl border border-agora-border bg-agora-surface/40 animate-pulse"
                            />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        searching={!!debouncedSearch}
                        hasUserPresets={userPresetCount > 0}
                        onCreate={() => setCreating(true)}
                    />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filtered.map((p) => (
                            <PresetCard
                                key={p.id}
                                preset={p}
                                onApply={() => handleApply(p)}
                                onEdit={() => setEditing(p)}
                                onDuplicate={() => handleDuplicate(p)}
                                onDelete={() => handleDelete(p)}
                            />
                        ))}
                    </div>
                )}
            </main>

            <AgentPresetFormModal
                open={creating}
                onClose={() => setCreating(false)}
                onSubmit={handleCreate}
                submitLabel="Create"
            />
            <AgentPresetFormModal
                open={!!editing}
                onClose={() => setEditing(null)}
                initial={editing}
                onSubmit={handleEdit}
                submitLabel="Save Changes"
            />
        </div>
    );
}

// ── Components ─────────────────────────────────────────────────────────────

function EmptyState({
    searching,
    hasUserPresets,
    onCreate,
}: {
    searching: boolean;
    hasUserPresets: boolean;
    onCreate: () => void;
}) {
    if (searching) {
        return (
            <div className="text-center py-16 border border-dashed border-agora-border/50 rounded-xl">
                <p className="text-sm text-agora-text-muted">No presets found.</p>
            </div>
        );
    }
    if (!hasUserPresets) {
        return (
            <div className="text-center py-16 border border-dashed border-agora-border/50 rounded-xl">
                <p className="text-sm text-agora-text-muted">
                    No custom presets yet. Create your first reusable agent configuration.
                </p>
                <button
                    onClick={onCreate}
                    className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                >
                    + Create Preset
                </button>
            </div>
        );
    }
    return null;
}

function PresetCard({
    preset,
    onApply,
    onEdit,
    onDuplicate,
    onDelete,
}: {
    preset: AgentPreset;
    onApply: () => void;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const isSystem = isSystemPreset(preset);
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col rounded-xl border border-agora-border bg-agora-surface p-4 hover:border-indigo-500/30 transition-colors"
        >
            <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white truncate">{preset.name}</h3>
                <span
                    className={cn(
                        "px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0",
                        isSystem
                            ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                            : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
                    )}
                >
                    {isSystem ? "System" : "User"}
                </span>
            </div>
            {preset.description && (
                <p className="text-[11px] text-agora-text-muted line-clamp-2 mb-2">
                    {preset.description}
                </p>
            )}
            <p className="text-[11px] text-agora-text-muted/80 line-clamp-2 mb-3 italic">
                {preset.role_description || "—"}
            </p>

            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-agora-text-muted mb-3">
                <Meta label="Style" value={preset.reasoning_style} />
                <Meta label="Depth" value={preset.reasoning_depth} />
                <Meta label="Provider" value={preset.provider} />
                <Meta label="Temp" value={preset.temperature.toFixed(1)} />
                <Meta label="Model" value={preset.model} className="col-span-2" />
                <Meta
                    label="RAG"
                    value={
                        preset.rag_mode === "no_docs"
                            ? "No docs"
                            : preset.rag_mode === "shared_session_docs"
                                ? "Shared docs"
                                : `Assigned (${preset.document_ids.length})`
                    }
                    className="col-span-2"
                />
            </div>

            <div className="mt-auto flex items-center gap-1.5 flex-wrap">
                <button
                    onClick={onApply}
                    className="px-2.5 py-1.5 rounded-md text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                >
                    Use in Debate
                </button>
                {!isSystem && (
                    <button
                        onClick={onEdit}
                        className="px-2.5 py-1.5 rounded-md text-[10px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/30 transition-colors"
                    >
                        Edit
                    </button>
                )}
                <button
                    onClick={onDuplicate}
                    className="px-2.5 py-1.5 rounded-md text-[10px] font-medium border border-agora-border text-agora-text-muted hover:text-white hover:border-indigo-500/30 transition-colors"
                >
                    Duplicate
                </button>
                {!isSystem && (
                    <button
                        onClick={onDelete}
                        className="ml-auto px-2.5 py-1.5 rounded-md text-[10px] font-medium border border-agora-border text-agora-text-muted hover:text-red-300 hover:border-red-500/30 transition-colors"
                    >
                        Delete
                    </button>
                )}
            </div>
        </motion.div>
    );
}

function Meta({
    label,
    value,
    className,
}: {
    label: string;
    value: string;
    className?: string;
}) {
    return (
        <div className={cn("truncate", className)}>
            <span className="text-agora-text-muted/60 mr-1">{label}:</span>
            <span className="text-agora-text-muted">{value}</span>
        </div>
    );
}
