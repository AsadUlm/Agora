import { useCallback, useState } from "react";
import { startDebate } from "../services/debateService";
import type {
    AgentInput,
    DebateStartResponse,
} from "../types/debate";

interface UseStartDebateReturn {
    result: DebateStartResponse | null;
    loading: boolean;
    error: string | null;
    run: (question: string, agents: AgentInput[]) => Promise<void>;
    reset: () => void;
}

export function useStartDebate(): UseStartDebateReturn {
    const [result, setResult] = useState<DebateStartResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(async (question: string, agents: AgentInput[]) => {
        setLoading(true);
        setError(null);
        try {
            const data = await startDebate({ question, agents });
            setResult(data);
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Failed to start debate";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    const reset = useCallback(() => {
        setResult(null);
        setError(null);
    }, []);

    return { result, loading, error, run, reset };
}
