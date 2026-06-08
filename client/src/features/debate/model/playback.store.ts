import { create } from "zustand";

interface PlaybackStore {
    currentRound: number;
    maxRound: number;
    speed: number; // 1 = normal, 2 = fast, 0.5 = slow
    isPlaying: boolean;
    /** User-selected round for highlighting (null = show all) */
    selectedRound: number | null;
    /**
     * Currently focused debate cycle. 1 = original debate, 2+ = follow-up cycles.
     * Default 1. The graph renders only nodes belonging to this cycle.
     */
    selectedCycle: number;

    setCurrentRound: (round: number) => void;
    setMaxRound: (round: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    setSpeed: (speed: number) => void;
    togglePlaying: () => void;
    setSelectedRound: (round: number | null) => void;
    setSelectedCycle: (cycle: number) => void;
    reset: () => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
    currentRound: 0,
    maxRound: 3,
    speed: 1,
    isPlaying: false,
    selectedRound: null,
    selectedCycle: 1,

    setCurrentRound: (round) => set({ currentRound: round }),
    setMaxRound: (round) => set({ maxRound: round }),

    nextStep: () => {
        const { currentRound, maxRound } = get();
        if (currentRound < maxRound) {
            set({ currentRound: currentRound + 1 });
        }
    },

    prevStep: () => {
        const { currentRound } = get();
        if (currentRound > 1) {
            set({ currentRound: currentRound - 1 });
        }
    },

    setSpeed: (speed) => set({ speed }),
    togglePlaying: () => set((s) => ({ isPlaying: !s.isPlaying })),
    setSelectedRound: (round) => set({ selectedRound: round }),
    /**
     * Switching cycles ALWAYS clears the per-round filter, otherwise an old
     * "Round 3" highlight from cycle 1 would bleed into the new cycle and
     * cause the moderator panel to show stale Round 3 metadata.
     */
    setSelectedCycle: (cycle) =>
        set({ selectedCycle: Math.max(1, cycle), selectedRound: null }),
    reset: () =>
        set({
            currentRound: 0,
            maxRound: 3,
            speed: 1,
            isPlaying: false,
            selectedRound: null,
            selectedCycle: 1,
        }),
}));

