import { useCallback, useState } from "react";
import type { AxiosError } from "axios";
import { startDebate } from "../../../services/debateService";
import type { AgentCreateRequest, DebateStartResponse } from "../../../types/debate";

// ── Agent draft — mutable form state for one agent ────────────────────

export interface AgentDraft {
    localId: string;
    role: string;
}

const DEFAULT_AGENTS: AgentDraft[] = [
    { localId: "agent-1", role: "Proponent" },
    { localId: "agent-2", role: "Critic" },
];

// ── Error extraction from Axios errors ───────────────────────────────

function extractApiError(err: unknown): string {
    const axiosErr = err as AxiosError<{ detail?: string }>;
    const detail = axiosErr.response?.data?.detail;
    if (detail) return String(detail);
    if (axiosErr instanceof Error) return axiosErr.message;
    return "An unexpected error occurred. Please try again.";
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useDebate() {
    const [question, setQuestion] = useState("");
    const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [result, setResult] = useState<DebateStartResponse | null>(null);

    const addAgent = useCallback(() => {
        setAgents((prev) => [
            ...prev,
            { localId: `agent-${Date.now()}`, role: "" },
        ]);
    }, []);

    const updateAgent = useCallback((localId: string, role: string) => {
        setAgents((prev) =>
            prev.map((a) => (a.localId === localId ? { ...a, role } : a)),
        );
    }, []);

    const removeAgent = useCallback((localId: string) => {
        setAgents((prev) => prev.filter((a) => a.localId !== localId));
    }, []);

    const clearError = useCallback(() => setSubmitError(null), []);

    const submit = useCallback(async () => {
        setSubmitError(null);
        setIsSubmitting(true);

        const agentRequests: AgentCreateRequest[] = agents.map((a) => ({
            role: a.role.trim(),
            config: {},
        }));

        try {
            const data = await startDebate({
                question: question.trim(),
                agents: agentRequests,
            });
            setResult(data);
        } catch (err) {
            setSubmitError(extractApiError(err));
        } finally {
            setIsSubmitting(false);
        }
    }, [question, agents]);

    const reset = useCallback(() => {
        setQuestion("");
        setAgents(DEFAULT_AGENTS);
        setResult(null);
        setSubmitError(null);
        setIsSubmitting(false);
    }, []);

    return {
        question,
        setQuestion,
        agents,
        addAgent,
        updateAgent,
        removeAgent,
        isSubmitting,
        submitError,
        clearError,
        submit,
        result,
        reset,
    };
}
