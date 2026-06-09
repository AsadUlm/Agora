import type { SessionDetailDTO } from "../api/debate.types";
import type { StreamStatus } from "../api/debate.ws";
import type { GenerationError } from "./debate.store";
import {
    deriveDebateExecutionState,
    type DebateExecutionState,
    type DebateStage,
} from "./execution-state";

export type DebateViewStatus =
    | DebateExecutionState["debateStatus"]
    | "interrupted";

export interface DebateBannerState {
    type: "none" | "info" | "warning" | "error";
    title: string;
    message: string;
}

export interface DebateViewState {
    backendStatus: string;
    derivedStatus: DebateViewStatus;
    execution: DebateExecutionState;
    currentStage: number;
    visibleStageLabel: string;
    stages: DebateStage[];
    banner: DebateBannerState;
    statusLabel: string;
    progress: DebateExecutionState["progress"];
    graphState: "live" | "preserved_partial" | "completed" | "failed";
    canRetry: boolean;
    canRetrySynthesis: boolean;
    canReloadStatus: boolean;
    error: GenerationError | null;
}

export interface DebateViewInput {
    session: SessionDetailDTO | null;
    turnStatus: string | null;
    loadError: string | null;
    generationError: GenerationError | null;
    streamStatus: StreamStatus;
}

/** Single source of truth for every user-facing debate lifecycle state. */
export function deriveDebateViewState(debate: DebateViewInput): DebateViewState {
    const baseExecution = deriveDebateExecutionState(
        debate.session,
        debate.turnStatus,
        debate.loadError,
    );
    const error = debate.generationError
        ?? normalizePersistedError(debate.session?.latest_turn?.error);
    const backendStatus =
        debate.session?.latest_turn?.status
        ?? debate.session?.status
        ?? baseExecution.debateStatus;
    const interrupted =
        debate.streamStatus === "interrupted"
        && (baseExecution.debateStatus === "queued" || baseExecution.debateStatus === "running");
    const partial = error?.partialResultsAvailable || error?.severity === "partial";
    const derivedStatus: DebateViewStatus = interrupted
        ? "interrupted"
        : partial
            ? "partially_completed"
            : baseExecution.debateStatus;
    const execution: DebateExecutionState = derivedStatus === "partially_completed"
        ? { ...baseExecution, debateStatus: "partially_completed" }
        : baseExecution;
    const currentStage = execution.activeStage ?? 1;
    const visibleStageLabel = execution.stages[currentStage - 1]?.label
        ?? "Stage 1: Initial Positions";
    const banner = deriveBanner(derivedStatus, error);

    return {
        backendStatus,
        derivedStatus,
        execution,
        currentStage,
        visibleStageLabel,
        stages: execution.stages,
        banner,
        statusLabel: statusLabel(derivedStatus),
        progress: execution.progress,
        graphState:
            derivedStatus === "partially_completed"
                ? "preserved_partial"
                : derivedStatus === "failed"
                    ? "failed"
                    : derivedStatus === "completed"
                        ? "completed"
                        : "live",
        canRetry: Boolean(error?.retryable),
        canRetrySynthesis:
            derivedStatus === "partially_completed"
            && error?.phase === "final_synthesis"
            && Boolean(error.retryable),
        canReloadStatus: derivedStatus === "interrupted" || derivedStatus === "failed" || derivedStatus === "partially_completed",
        error,
    };
}

function deriveBanner(status: DebateViewStatus, error: GenerationError | null): DebateBannerState {
    if (status === "interrupted") {
        return {
            type: "info",
            title: "Connection interrupted",
            message: "Checking saved status…",
        };
    }
    if (status === "partially_completed") {
        return {
            type: "warning",
            title: error?.phase === "final_synthesis" ? "Final synthesis failed" : "Debate partially completed",
            message:
                error?.userMessage
                ?? "Agent responses are available. Reload status or retry the failed stage.",
        };
    }
    if (status === "failed") {
        return {
            type: "error",
            title: "Debate failed",
            message:
                error?.userMessage
                ?? "Generation failed without a detailed provider reason. Reload saved status.",
        };
    }
    return { type: "none", title: "", message: "" };
}

function statusLabel(status: DebateViewStatus): string {
    return {
        queued: "QUEUED",
        running: "RUNNING",
        interrupted: "CHECKING STATUS",
        partially_completed: "PARTIALLY COMPLETED",
        completed: "COMPLETED",
        failed: "FAILED",
        cancelled: "CANCELLED",
    }[status];
}

function normalizePersistedError(
    error: SessionDetailDTO["latest_turn"] extends infer _T ? NonNullable<SessionDetailDTO["latest_turn"]>["error"] : never,
): GenerationError | null {
    if (!error) return null;
    return {
        code: error.code,
        message: error.message,
        userMessage: error.user_message ?? error.message,
        retryable: error.retryable,
        severity: error.severity,
        phase: error.phase,
        failedAgents: error.failed_agents,
        successfulAgents: error.successful_agents,
        partialResultsAvailable: error.partial_results_available,
        requestId: error.request_id,
        lastSuccessfulStage: error.last_successful_stage,
        provider: error.provider,
        model: error.model,
        statusCode: error.status_code,
        roundNumber: error.round_number,
        roundType: error.round_type,
        timestamp: error.timestamp,
    };
}
