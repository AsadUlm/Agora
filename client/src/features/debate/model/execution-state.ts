import type { AgentDTO, RoundDTO, SessionDetailDTO, TurnDTO } from "../api/debate.types";

export type DebateExecutionStatus =
    | "queued"
    | "running"
    | "partially_completed"
    | "completed"
    | "failed"
    | "cancelled";

export type StageStatus =
    | "locked"
    | "waiting"
    | "running"
    | "partially_completed"
    | "completed"
    | "failed"
    | "skipped";

export type RoundStatus = StageStatus;
export type AgentTurnStatus = "waiting" | "generating" | "completed" | "failed";

export interface AgentTurnState {
    agentId: string;
    role: string;
    status: AgentTurnStatus;
}

export interface DebateStage {
    index: number;
    label: string;
    shortLabel: string;
    roundType: string;
    status: StageStatus;
    completedCount: number;
    totalCount: number;
    failedCount: number;
    generatingAgentId: string | null;
    generatingAgentRole: string | null;
    lockedReason: string | null;
    activityMessages: string[];
}

export interface RoundExecutionState extends DebateStage {
    roundNumber: number;
    agentTurns: AgentTurnState[];
}

export interface DebateProgressState {
    completedSteps: number;
    totalSteps: number;
    percentage: number;
    label: string;
    sublabel: string;
}

export interface DebateExecutionState {
    debateStatus: DebateExecutionStatus;
    activeRound: number;
    activeStage: number | null;
    currentAgentId: string | null;
    currentAgentRole: string | null;
    rounds: RoundExecutionState[];
    stages: DebateStage[];
    progress: DebateProgressState;
    failureMessage: string | null;
    is5Stage: true;
}

export const DEBATE_STAGE_DEFS = [
    { index: 1, label: "Stage 1: Initial Positions", shortLabel: "Initial Positions", roundType: "initial" },
    { index: 2, label: "Stage 2: Cross-Critiques", shortLabel: "Cross-Critiques", roundType: "critique" },
    { index: 3, label: "Stage 3: Responses to Critiques", shortLabel: "Responses to Critiques", roundType: "critique_response" },
    { index: 4, label: "Stage 4: Revised Positions", shortLabel: "Revised Positions", roundType: "revised_position" },
    { index: 5, label: "Stage 5: Final Synthesis", shortLabel: "Final Synthesis", roundType: "final" },
] as const;

export function deriveDebateExecutionState(
    session: SessionDetailDTO | null,
    turnStatusOverride: string | null,
    storeError: string | null,
): DebateExecutionState {
    const turn = session?.latest_turn ?? null;
    const agents = session?.agents ?? [];
    // A loaded REST snapshot is the durable source of truth. WebSocket/store
    // state is only a fallback while no snapshot is available.
    const debateStatus = normalizeStatus(turn?.status ?? session?.status ?? turnStatusOverride);
    const stages = DEBATE_STAGE_DEFS.map((definition) =>
        deriveStage(definition, turn, agents, debateStatus),
    );
    const runningStage = stages.find((stage) => stage.status === "running");
    const currentStage = clampStage(turn?.current_stage ?? runningStage?.index ?? inferActiveStage(stages, debateStatus));
    const current = stages[currentStage - 1];
    const terminalCount = stages.filter((stage) =>
        stage.status === "completed" || stage.status === "partially_completed" || stage.status === "skipped",
    ).length;
    const percentage = debateStatus === "completed"
        ? 100
        : Math.round((terminalCount / DEBATE_STAGE_DEFS.length) * 100);
    const failureMessage =
        turn?.error?.user_message
        ?? turn?.error?.message
        ?? (debateStatus === "failed" ? storeError : null)
        ?? null;

    return {
        debateStatus,
        activeRound: currentStage,
        activeStage: currentStage,
        currentAgentId: current?.generatingAgentId ?? null,
        currentAgentRole: current?.generatingAgentRole ?? null,
        rounds: stages.map((stage) => ({
            ...stage,
            roundNumber: stage.index,
            agentTurns: deriveAgentTurns(stage, agents),
        })),
        stages,
        progress: {
            completedSteps: terminalCount,
            totalSteps: DEBATE_STAGE_DEFS.length,
            percentage,
            label: statusLabel(debateStatus),
            sublabel: current?.label ?? "Stage 1: Initial Positions",
        },
        failureMessage,
        is5Stage: true,
    };
}

function deriveStage(
    definition: typeof DEBATE_STAGE_DEFS[number],
    turn: TurnDTO | null,
    agents: AgentDTO[],
    debateStatus: DebateExecutionStatus,
): DebateStage {
    const round = findBaseRound(turn, definition.roundType);
    const messages = round?.messages.filter((message) => message.sender_type === "agent") ?? [];
    const failedIds = new Set(
        messages
            .filter((message) =>
                message.payload?.generation_status === "failed"
                || message.payload?.is_fallback === true,
            )
            .map((message) => message.agent_id),
    );
    const completedIds = new Set(
        messages
            .filter((message) => message.agent_id && !failedIds.has(message.agent_id))
            .map((message) => message.agent_id),
    );
    const status = deriveStageStatus(definition.index, round, turn, debateStatus);
    const nextAgent = status === "running"
        ? agents.find((agent) => !completedIds.has(agent.id) && !failedIds.has(agent.id))
        : null;

    return {
        ...definition,
        status,
        completedCount: completedIds.size,
        totalCount: agents.length,
        failedCount: failedIds.size,
        generatingAgentId: nextAgent?.id ?? null,
        generatingAgentRole: nextAgent?.role ?? null,
        lockedReason: status === "locked" ? "Previous stage is not complete" : null,
        activityMessages: messages
            .filter((message) => !failedIds.has(message.agent_id))
            .map((message) => `${message.agent_role ?? "Agent"} completed ${definition.shortLabel}.`),
    };
}

function deriveStageStatus(
    index: number,
    round: RoundDTO | undefined,
    turn: TurnDTO | null,
    debateStatus: DebateExecutionStatus,
): StageStatus {
    if (index === 5 && turn?.synthesis_status === "failed") return "failed";
    if (index === 5 && turn?.synthesis_status === "skipped") return "skipped";
    if (round?.status === "partially_completed") return "partially_completed";
    if (round?.status === "completed") return "completed";
    if (round?.status === "failed") return "failed";
    if (round?.status === "running") return "running";
    if (debateStatus === "completed") return "completed";
    const current = clampStage(turn?.current_stage ?? 1);
    if (index === current && debateStatus === "running") return "running";
    if (index < current) return "completed";
    if (index === current || index === current + 1) return "waiting";
    return "locked";
}

function deriveAgentTurns(stage: DebateStage, agents: AgentDTO[]): AgentTurnState[] {
    return agents.map((agent) => ({
        agentId: agent.id,
        role: agent.role,
        status:
            stage.generatingAgentId === agent.id
                ? "generating"
                : stage.failedCount > 0 && stage.completedCount + stage.failedCount >= stage.totalCount
                    ? "failed"
                    : stage.status === "completed" || stage.status === "partially_completed"
                        ? "completed"
                        : "waiting",
    }));
}

function findBaseRound(turn: TurnDTO | null, roundType: string): RoundDTO | undefined {
    return turn?.rounds.find((round) =>
        (round.cycle_number ?? 1) === 1 && round.round_type === roundType,
    );
}

function inferActiveStage(stages: DebateStage[], status: DebateExecutionStatus): number {
    if (status === "completed" || status === "partially_completed") return 5;
    const failed = stages.find((stage) => stage.status === "failed");
    if (failed) return failed.index;
    const firstOpen = stages.find((stage) => stage.status !== "completed" && stage.status !== "partially_completed");
    return firstOpen?.index ?? 5;
}

function clampStage(value: number): number {
    return Math.max(1, Math.min(5, value));
}

function normalizeStatus(value: string | null | undefined): DebateExecutionStatus {
    if (
        value === "running"
        || value === "partially_completed"
        || value === "completed"
        || value === "failed"
        || value === "cancelled"
    ) {
        return value;
    }
    return "queued";
}

function statusLabel(status: DebateExecutionStatus): string {
    if (status === "partially_completed") return "Debate Partially Completed";
    if (status === "completed") return "Debate Complete";
    if (status === "failed") return "Debate Failed";
    if (status === "cancelled") return "Debate Cancelled";
    if (status === "running") return "Debate Running";
    return "Queued for execution";
}
