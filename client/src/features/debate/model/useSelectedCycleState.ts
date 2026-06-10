import { useMemo } from "react";
import { useDebateStore } from "./debate.store";
import { deriveSelectedCycleState, getSelectedCycle } from "./debate-cycle.selectors";
import { usePlaybackStore } from "./playback.store";

export function useSelectedCycleState() {
    const session = useDebateStore((state) => state.session);
    const selectedCycleNumber = usePlaybackStore((state) => state.selectedCycle);

    return useMemo(() => ({
        cycle: getSelectedCycle(session, selectedCycleNumber),
        state: deriveSelectedCycleState(session, selectedCycleNumber),
    }), [session, selectedCycleNumber]);
}
