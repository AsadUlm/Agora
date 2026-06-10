import { useMemo } from "react";
import { useDebateStore } from "./debate.store";
import { deriveDebateViewState } from "./debate-view-state";

export function useDebateViewState() {
    const session = useDebateStore((state) => state.session);
    const turnStatus = useDebateStore((state) => state.turnStatus);
    const loadError = useDebateStore((state) => state.error);
    const generationError = useDebateStore((state) => state.generationError);
    const streamStatus = useDebateStore((state) => state.streamStatus);

    return useMemo(
        () => deriveDebateViewState({
            session,
            turnStatus,
            loadError,
            generationError,
            streamStatus,
        }),
        [session, turnStatus, loadError, generationError, streamStatus],
    );
}
