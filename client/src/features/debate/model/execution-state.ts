import type {
    AgentDTO,
    MessageDTO,
    RoundDTO,
    SessionDetailDTO,
    TurnDTO,
} from "../api/debate.types";
import { isErrorPayload, isErrorText } from "./error-normalizer";

export type DebateExecutionStatus =
    | "queued"
    | "running"
    | "completed"
    | "failed";

export type RoundStatus =
    | "locked"
    | "waiting"
    | "running"
    | "completed"
    | "failed";

export type AgentTurnStatus =
    | "waiting"
    | "generating"
    | "completed"
    | "failed";

export interface AgentTurnState {
    agentId: string;
    role: string;
    status: AgentTurnStatus;
}

export interface RoundExecutionState {
    roundNumber: 1 | 2 | 3;
    label: string;
    status: RoundStatus;
    lockedReason: string | null;
    completedCount: number;
    totalCount: number;
    failedCount: number;
    generatingAgentId: string | null;
    generatingAgentRole: string | null;
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
    activeRound: 1 | 2 | 3;
    currentAgentId: string | null;
    currentAgentRole: string | null;
    rounds: RoundExecutionState[];
    progress: DebateProgressState;
    failureMessage: string | null;
}

interface AgentRoundCounter {
    completed: Set<string>;
    failed: Set<string>;
}

const ROUND_LABELS: Record<1 | 2 | 3, string> = {
    1: "Initial Proposal",
    2: "Debate & Critique",
    3: "Synthesis",
};

export function deriveDebateExecutionState(
    session: SessionDetailDTO | null,
    turnStatusOverride: string | null,
    storeError: string | null,
): DebateExecutionState {
    const agents = session?.agents ?? [];
    const turn = session?.latest_turn ?? null;
    const totalAgentTurns = agents.length;

    const debateStatus = normalizeDebateStatus(
        turnStatusOverride ?? turn?.status ?? session?.status ?? "queued",
    );

    const round1 = findRound(turn, 1);
    const round2 = findRound(turn, 2);
    const round3 = findRound(turn, 3);

    const r1 = countRoundByAgent(round1);
    const r2 = countRoundByAgent(round2);

    const round1Done = r1.completed.size + r1.failed.size;
    const round2Done = r2.completed.size + r2.failed.size;

    const round1Completed = totalAgentTurns > 0
        ? round1Done >= totalAgentTurns || round1?.status === "completed"
        : round1?.status === "completed";

    const round2Completed = totalAgentTurns > 0
        ? round2Done >= totalAgentTurns || round2?.status === "completed"
        : round2?.status === "completed";

    const synthesisCompleted =
        Boolean(turn?.final_summary) ||
        round3?.status === "completed" ||
        debateStatus === "completed";

    const activeRound = inferActiveRound(
        debateStatus,
        round1Completed,
        round2Completed,
    );

    const round1Generating =
        debateStatus === "running" && activeRound === 1
            ? inferGeneratingAgentId(agents, r1)
            : null;

    const round2Generating =
        debateStatus === "running" && activeRound === 2
            ? inferGeneratingAgentId(agents, r2)
            : null;

    const roundStates: RoundExecutionState[] = [
        buildRoundState({
            roundNumber: 1,
            status: buildRound1Status(
                debateStatus,
                round1Completed,
                round1,
                activeRound,
            ),
            lockedReason: null,
            counters: r1,
            agents,
            generatingAgentId: round1Generating,
        }),
        buildRoundState({
            roundNumber: 2,
            status: buildRound2Status(
                debateStatus,
                round1Completed,
                round2Completed,
                round2,
                activeRound,
            ),
            lockedReason: round1Completed ? null : "Waiting for Round 1",
            counters: r2,
            agents,
            generatingAgentId: round2Generating,
        }),
        {
            roundNumber: 3,
            label: ROUND_LABELS[3],
            status: buildRound3Status(
                debateStatus,
                round2Completed,
                synthesisCompleted,
                round3,
                activeRound,
            ),
            lockedReason: round2Completed ? null : "Waiting for Round 2",
            completedCount: synthesisCompleted ? 1 : 0,
            totalCount: 1,
            failedCount: round3?.status === "failed" ? 1 : 0,
            generatingAgentId:
                debateStatus === "running" && activeRound === 3 && !synthesisCompleted
                    ? "synthesis"
                    : null,
            generatingAgentRole:
                debateStatus === "running" && activeRound === 3 && !synthesisCompleted
                    ? "Synthesis"
                    : null,
            agentTurns: [],
        },
    ];

    const doneStepCount =
        1 + // question node
        round1Done +
        round2Done +
        (synthesisCompleted ? 1 : 0);

    const totalSteps = 1 + totalAgentTurns + totalAgentTurns + 1;
    const clampedDone = Math.max(0, Math.min(doneStepCount, totalSteps));
    const percentage = totalSteps > 0
        ? Math.round((clampedDone / totalSteps) * 100)
        : 0;

    const currentAgentRole =
        activeRound === 1
            ? roleById(agents, round1Generating)
            : activeRound === 2
                ? roleById(agents, round2Generating)
                : debateStatus === "running" && !synthesisCompleted
                    ? "Synthesis"
                    : null;

    const progressLabel = buildProgressLabel(
        debateStatus,
        activeRound,
        currentAgentRole,
    );

    const failureMessage =
        debateStatus === "failed"
            ? storeError ?? extractTurnFailure(turn)
            : null;

    return {
        debateStatus,
        activeRound,
        currentAgentId:
            activeRound === 1
                ? round1Generating
                : activeRound === 2
                    ? round2Generating
                    : debateStatus === "running" && !synthesisCompleted
                        ? "synthesis"
                        : null,
        currentAgentRole,
        rounds: roundStates,
        progress: {
            completedSteps: clampedDone,
            totalSteps,
            percentage,
            label: progressLabel,
            sublabel: `${clampedDone} / ${totalSteps} steps completed`,
        },
        failureMessage,
    };
}

function buildRoundState(args: {
    roundNumber: 1 | 2;
    status: RoundStatus;
    lockedReason: string | null;
    counters: AgentRoundCounter;
    agents: AgentDTO[];
    generatingAgentId: string | null;
}): RoundExecutionState {
    const { roundNumber, status, lockedReason, counters, agents, generatingAgentId } = args;

    const completedCount = counters.completed.size;
    const failedCount = counters.failed.size;

    const agentTurns: AgentTurnState[] = agents.map((agent) => {
        let turnStatus: AgentTurnStatus = "waiting";
        if (counters.failed.has(agent.id)) {
            turnStatus = "failed";
        } else if (counters.completed.has(agent.id)) {
            turnStatus = "completed";
        } else if (status === "running" && generatingAgentId === agent.id) {
            turnStatus = "generating";
        }
        return {
            agentId: agent.id,
            role: agent.role,
            status: turnStatus,
        };
    });

    return {
        roundNumber,
        label: ROUND_LABELS[roundNumber],
        status,
        lockedReason,
        completedCount,
        totalCount: agents.length,
        failedCount,
        generatingAgentId,
        generatingAgentRole: roleById(agents, generatingAgentId),
        agentTurns,
    };
}

function normalizeDebateStatus(raw: string): DebateExecutionStatus {
    if (raw === "running") return "running";
    if (raw === "completed") return "completed";
    if (raw === "failed") return "failed";
    return "queued";
}

function findRound(turn: TurnDTO | null, roundNumber: number): RoundDTO | null {
    if (!turn) return null;
    return turn.rounds.find((r) => r.round_number === roundNumber) ?? null;
}

function inferActiveRound(
    debateStatus: DebateExecutionStatus,
    round1Completed: boolean,
    round2Completed: boolean,
): 1 | 2 | 3 {
    if (debateStatus === "queued") return 1;
    if (debateStatus === "running") {
        if (!round1Completed) return 1;
        if (!round2Completed) return 2;
        return 3;
    }
    if (debateStatus === "failed") {
        if (!round1Completed) return 1;
        if (!round2Completed) return 2;
        return 3;
    }
    return 3;
}

function buildRound1Status(
    debateStatus: DebateExecutionStatus,
    round1Completed: boolean,
    round1: RoundDTO | null,
    activeRound: 1 | 2 | 3,
): RoundStatus {
    if (round1?.status === "failed" || (debateStatus === "failed" && activeRound === 1 && !round1Completed)) {
        return "failed";
    }
    if (round1Completed) return "completed";
    if (debateStatus === "running" && activeRound === 1) return "running";
    return "waiting";
}

function buildRound2Status(
    debateStatus: DebateExecutionStatus,
    round1Completed: boolean,
    round2Completed: boolean,
    round2: RoundDTO | null,
    activeRound: 1 | 2 | 3,
): RoundStatus {
    if (!round1Completed) return "locked";
    if (round2?.status === "failed" || (debateStatus === "failed" && activeRound === 2 && !round2Completed)) {
        return "failed";
    }
    if (round2Completed) return "completed";
    if (debateStatus === "running" && activeRound === 2) return "running";
    return "waiting";
}

function buildRound3Status(
    debateStatus: DebateExecutionStatus,
    round2Completed: boolean,
    synthesisCompleted: boolean,
    round3: RoundDTO | null,
    activeRound: 1 | 2 | 3,
): RoundStatus {
    if (!round2Completed) return "locked";
    if (round3?.status === "failed" || (debateStatus === "failed" && activeRound === 3 && !synthesisCompleted)) {
        return "failed";
    }
    if (synthesisCompleted) return "completed";
    if (debateStatus === "running") return "running";
    return "waiting";
}

function countRoundByAgent(round: RoundDTO | null): AgentRoundCounter {
    const completed = new Set<string>();
    const failed = new Set<string>();
    if (!round) return { completed, failed };

    const ordered = [...round.messages].sort((a, b) => a.sequence_no - b.sequence_no);
    const latestByAgent = new Map<string, MessageDTO>();
    for (const msg of ordered) {
        if (!msg.agent_id) continue;
        latestByAgent.set(msg.agent_id, msg);
    }

    for (const [agentId, msg] of latestByAgent) {
        if (isFailedMessage(msg)) failed.add(agentId);
        else completed.add(agentId);
    }

    return { completed, failed };
}

function inferGeneratingAgentId(
    agents: AgentDTO[],
    counters: AgentRoundCounter,
): string | null {
    for (const agent of agents) {
        if (!counters.completed.has(agent.id) && !counters.failed.has(agent.id)) {
            return agent.id;
        }
    }
    return null;
}

function isFailedMessage(message: MessageDTO): boolean {
    const generationStatus =
        typeof message.payload?.["generation_status"] === "string"
            ? String(message.payload["generation_status"]).toLowerCase()
            : "";

    if (generationStatus === "failed") return true;
    if (isErrorPayload(message.payload ?? {})) return true;
    if (isErrorText(message.text)) return true;
    return false;
}

function roleById(agents: AgentDTO[], agentId: string | null): string | null {
    if (!agentId) return null;
    return agents.find((a) => a.id === agentId)?.role ?? null;
}

function buildProgressLabel(
    debateStatus: DebateExecutionStatus,
    activeRound: 1 | 2 | 3,
    currentAgentRole: string | null,
): string {
    if (debateStatus === "completed") return "Debate Complete";
    if (debateStatus === "failed") return "Debate Failed";
    if (debateStatus === "queued") return "Queued for execution";

    if (activeRound === 3) {
        return "Generating Round 3: Synthesis";
    }

    if (currentAgentRole) {
        return `Generating Round ${activeRound}: ${capitalize(currentAgentRole)}`;
    }

    return `Generating Round ${activeRound}`;
}

function extractTurnFailure(turn: TurnDTO | null): string | null {
    if (!turn) return null;
    for (const round of turn.rounds) {
        for (const msg of round.messages) {
            if (!isFailedMessage(msg)) continue;
            const err = messageErrorText(msg);
            if (err) return err;
        }
    }
    return null;
}

function messageErrorText(msg: MessageDTO): string | null {
    const payload = msg.payload ?? {};
    if (typeof payload["error"] === "string" && payload["error"].trim()) {
        return payload["error"].trim();
    }
    if (typeof payload["text"] === "string" && payload["text"].trim()) {
        return payload["text"].trim();
    }
    if (typeof msg.text === "string" && msg.text.trim()) {
        return msg.text.trim();
    }
    return null;
}

function capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
