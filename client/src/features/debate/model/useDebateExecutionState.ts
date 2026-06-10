import { useDebateViewState } from "./useDebateViewState";

export function useDebateExecutionState() {
    return useDebateViewState().execution;
}
