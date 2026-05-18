/**
 * Lightweight in-memory cache + hook for the agent presets list.
 *
 * Used by the agent settings dropdown to pull the merged system+user
 * preset catalog without each AgentConfigCard re-fetching independently.
 */

import { useEffect, useState } from "react";
import { create } from "zustand";
import { listAgentPresets } from "../api/agent-preset.api";
import type { AgentPreset } from "../model/agent-preset.types";

interface PresetCacheState {
    presets: AgentPreset[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    upsert: (preset: AgentPreset) => void;
    remove: (id: string) => void;
}

export const useAgentPresetCache = create<PresetCacheState>((set, get) => ({
    presets: [],
    loading: false,
    loaded: false,
    error: null,
    refresh: async () => {
        if (get().loading) return;
        set({ loading: true, error: null });
        try {
            const items = await listAgentPresets({});
            set({ presets: items, loading: false, loaded: true });
        } catch {
            set({ loading: false, error: "Failed to load presets" });
        }
    },
    upsert: (preset) => set((s) => {
        const idx = s.presets.findIndex((p) => p.id === preset.id);
        const next = [...s.presets];
        if (idx >= 0) next[idx] = preset;
        else next.unshift(preset);
        return { presets: next };
    }),
    remove: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
}));

/** Hook: returns merged presets, loading state, and a refresh trigger. */
export function useAgentPresets(): {
    presets: AgentPreset[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
} {
    const { presets, loading, loaded, error, refresh } = useAgentPresetCache();
    const [didKick, setDidKick] = useState(false);

    useEffect(() => {
        if (!loaded && !didKick) {
            setDidKick(true);
            refresh();
        }
    }, [loaded, didKick, refresh]);

    return { presets, loading, error, refresh };
}
