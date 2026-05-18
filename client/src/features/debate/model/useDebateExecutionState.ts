import { useMemo } from "react";
import { useDebateStore } from "./debate.store";
import { deriveDebateExecutionState } from "./execution-state";

export function useDebateExecutionState() {
    const session = useDebateStore((s) => s.session);
    const turnStatus = useDebateStore((s) => s.turnStatus);
    const error = useDebateStore((s) => s.error);

    return useMemo(
        () => deriveDebateExecutionState(session, turnStatus, error),
        [session, turnStatus, error],
    );
}
