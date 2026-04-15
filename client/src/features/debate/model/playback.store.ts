import { create } from "zustand";

interface PlaybackStore {
    currentRound: number;
    maxRound: number;
    speed: number; // 1 = normal, 2 = fast, 0.5 = slow
    isPlaying: boolean;
    /** User-selected round for highlighting (null = show all) */
    selectedRound: number | null;

    setCurrentRound: (round: number) => void;
    setMaxRound: (round: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    setSpeed: (speed: number) => void;
    togglePlaying: () => void;
    setSelectedRound: (round: number | null) => void;
    reset: () => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
    currentRound: 0,
    maxRound: 3,
    speed: 1,
    isPlaying: false,
    selectedRound: null,

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
    reset: () =>
        set({ currentRound: 0, maxRound: 3, speed: 1, isPlaying: false, selectedRound: null }),
}));
