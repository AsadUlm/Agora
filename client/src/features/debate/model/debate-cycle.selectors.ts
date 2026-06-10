import type { MessageDTO, RoundDTO, SessionDetailDTO } from "../api/debate.types";

export type DebateCycleStatus = "queued" | "running" | "completed" | "partially_completed" | "failed";

export interface SelectedCycleState {
    cycleNumber: number;
    cycleType: "original" | "followup";
    status: DebateCycleStatus;
    activeStageLabel?: string;
    progressPercent: number;
    hasResponses: boolean;
    hasCritiques: boolean;
    hasUpdatedSynthesis: boolean;
    missingStages: string[];
    isStuckSuspected: boolean;
}

export interface DebateCycleModel {
    cycleNumber: number;
    cycleType: "original" | "followup";
    title: string;
    question: string;
    turnId?: string;
    followUpId?: string;
    rounds: RoundDTO[];
    stages: {
        initialAnswers: MessageDTO[];
        crossCritiques: MessageDTO[];
        responsesToCritiques: MessageDTO[];
        revisedPositions: MessageDTO[];
        finalSynthesis: MessageDTO[];
        moderatorVerdict: MessageDTO | null;
    };
    status: DebateCycleStatus;
}

const ORIGINAL_TYPES = new Set(["initial", "opening", "initial_position", "critique", "cross_critique", "critique_response", "rebuttal", "revised_position", "revision", "final", "synthesis", "final_synthesis"]);
const FOLLOWUP_RESPONSE_TYPES = ["followup_response"];
const FOLLOWUP_CRITIQUE_TYPES = ["followup_cross_critique", "followup_critique"];
const FOLLOWUP_RESPONSE_TO_CRITIQUE_TYPES = ["followup_response_to_critique"];
const FOLLOWUP_REVISED_TYPES = ["followup_revised_position"];
const FOLLOWUP_SYNTHESIS_TYPES = ["updated_synthesis", "followup_synthesis", "final"];

const FOLLOWUP_STAGE_DEFS = [
    { label: "Follow-up Responses", types: FOLLOWUP_RESPONSE_TYPES },
    { label: "Follow-up Cross-Critiques", types: FOLLOWUP_CRITIQUE_TYPES },
    { label: "Responses to Follow-up Critiques", types: FOLLOWUP_RESPONSE_TO_CRITIQUE_TYPES },
    { label: "Revised Follow-up Positions", types: FOLLOWUP_REVISED_TYPES },
    { label: "Updated Synthesis", types: FOLLOWUP_SYNTHESIS_TYPES },
] as const;

const FOLLOWUP_COMPACT_STAGE_DEFS = [
    { label: "Follow-up Responses", types: FOLLOWUP_RESPONSE_TYPES },
    { label: "Follow-up Critiques", types: FOLLOWUP_CRITIQUE_TYPES },
    { label: "Updated Synthesis", types: FOLLOWUP_SYNTHESIS_TYPES },
] as const;

const ORIGINAL_STAGE_DEFS = [
    { label: "Initial Positions", types: ["initial", "opening", "initial_position"] },
    { label: "Cross-Critiques", types: ["critique", "cross_critique"] },
    { label: "Responses to Critiques", types: ["critique_response", "rebuttal"] },
    { label: "Revised Positions", types: ["revised_position", "revision"] },
    { label: "Final Synthesis", types: ["final", "synthesis", "final_synthesis"] },
] as const;

function messages(rounds: RoundDTO[], types: string[]): MessageDTO[] {
    return rounds.filter((round) => types.includes(round.round_type)).flatMap((round) => round.messages);
}

function isVerdict(message: MessageDTO): boolean {
    const type = message.message_type.toLowerCase();
    const role = message.agent_role?.toLowerCase() ?? "";
    const innerType = String(message.payload?.message_type ?? "").toLowerCase();
    return message.sender_type === "judge"
        || role.includes("moderator")
        || type.includes("verdict")
        || innerType.includes("verdict");
}

function isUsableMessage(message: MessageDTO): boolean {
    return message.payload?.generation_status !== "failed"
        && message.payload?.generation_status !== "skipped";
}

function hasUsableMessages(rounds: RoundDTO[], types: readonly string[]): boolean {
    return rounds.some((round) =>
        types.includes(round.round_type)
        && round.messages.some(isUsableMessage),
    );
}

function isTerminalRound(round: RoundDTO): boolean {
    return ["completed", "partially_completed", "failed"].includes(round.status);
}

function latestCycleNumber(session: SessionDetailDTO | null): number {
    const followUpMax = Math.max(
        1,
        ...(session?.latest_turn?.follow_ups ?? []).map((item) => item.cycle_number),
    );
    const roundMax = Math.max(
        1,
        ...(session?.latest_turn?.rounds ?? []).map((round) => round.cycle_number ?? 1),
    );
    return Math.max(followUpMax, roundMax);
}

export function deriveSelectedCycleState(
    session: SessionDetailDTO | null,
    selectedCycleNumber: number,
): SelectedCycleState {
    const cycle = getSelectedCycle(session, selectedCycleNumber);
    const turn = session?.latest_turn;
    const rounds = cycle.rounds;
    const usesExpandedFollowup = rounds.some((round) =>
        ["followup_cross_critique", "followup_response_to_critique", "followup_revised_position"].includes(round.round_type),
    );
    const stageDefs: ReadonlyArray<{ label: string; types: readonly string[] }> =
        cycle.cycleType === "original"
            ? ORIGINAL_STAGE_DEFS
            : usesExpandedFollowup
                ? FOLLOWUP_STAGE_DEFS
                : FOLLOWUP_COMPACT_STAGE_DEFS;
    const activeRound = rounds.find((round) => round.status === "running")
        ?? rounds.find((round) => round.status === "queued");
    const activeStage = activeRound
        ? stageDefs.find((stage) => stage.types.includes(activeRound.round_type))
        : undefined;
    const hasResponses = hasUsableMessages(
        rounds,
        cycle.cycleType === "followup" ? FOLLOWUP_RESPONSE_TYPES : ORIGINAL_STAGE_DEFS[0].types,
    );
    const hasCritiques = hasUsableMessages(
        rounds,
        cycle.cycleType === "followup" ? FOLLOWUP_CRITIQUE_TYPES : ORIGINAL_STAGE_DEFS[1].types,
    );
    const hasUpdatedSynthesis = hasUsableMessages(
        rounds,
        cycle.cycleType === "followup" ? FOLLOWUP_SYNTHESIS_TYPES : ORIGINAL_STAGE_DEFS[4].types,
    );
    const missingStages = stageDefs
        .filter((stage) => !rounds.some((round) =>
            stage.types.includes(round.round_type) && isTerminalRound(round),
        ))
        .map((stage) => stage.label);
    const terminalStages = stageDefs.filter((stage) => rounds.some((round) =>
        stage.types.includes(round.round_type) && isTerminalRound(round),
    )).length;
    const isLatestCycle = cycle.cycleNumber === latestCycleNumber(session);
    const explicitTurnFailure = isLatestCycle && turn?.status === "failed";
    const hasFailedRound = rounds.some((round) => round.status === "failed");
    const hasPartialRound = rounds.some((round) => round.status === "partially_completed");
    const hasActiveRound = Boolean(activeRound);

    let status: DebateCycleStatus;
    if (explicitTurnFailure && !hasUpdatedSynthesis) {
        status = "failed";
    } else if (hasActiveRound) {
        status = activeRound?.status === "queued" ? "queued" : "running";
    } else if (hasUpdatedSynthesis) {
        status = hasFailedRound || hasPartialRound || missingStages.length > 0
            ? "partially_completed"
            : "completed";
    } else if (hasResponses) {
        status = "partially_completed";
    } else if (isLatestCycle && (turn?.status === "queued" || turn?.status === "running")) {
        status = turn.status;
    } else if (hasFailedRound) {
        status = "failed";
    } else {
        status = "queued";
    }

    return {
        cycleNumber: cycle.cycleNumber,
        cycleType: cycle.cycleType,
        status,
        activeStageLabel: activeStage?.label,
        progressPercent: status === "completed"
            ? 100
            : Math.round((terminalStages / stageDefs.length) * 100),
        hasResponses,
        hasCritiques,
        hasUpdatedSynthesis,
        missingStages,
        isStuckSuspected: Boolean(
            isLatestCycle
            && (turn?.status === "queued" || turn?.status === "running")
            && !hasActiveRound
            && rounds.length > 0,
        ),
    };
}

export function getSelectedCycle(
    session: SessionDetailDTO | null,
    selectedCycleNumber: number,
): DebateCycleModel {
    const cycleNumber = Math.max(1, selectedCycleNumber || 1);
    const turn = session?.latest_turn;
    const followUp = turn?.follow_ups?.find((item) => item.cycle_number === cycleNumber);
    const allRounds = turn?.rounds ?? [];
    const rounds = allRounds.filter((round) => {
        if (cycleNumber > 1) return round.cycle_number === cycleNumber;
        return (round.cycle_number ?? 1) === 1 && ORIGINAL_TYPES.has(round.round_type);
    });
    const synthesisMessages = messages(rounds, cycleNumber === 1
        ? ["final", "synthesis", "final_synthesis"]
        : FOLLOWUP_SYNTHESIS_TYPES);
    const selectedState = deriveSelectedCycleStateShallow(session, cycleNumber, rounds);

    return {
        cycleNumber,
        cycleType: cycleNumber === 1 ? "original" : "followup",
        title: cycleNumber === 1 ? "Original Debate" : `Follow-up #${cycleNumber - 1}`,
        question: cycleNumber === 1 ? session?.question ?? "" : followUp?.question ?? "",
        turnId: turn?.id,
        followUpId: followUp?.id,
        rounds,
        stages: {
            initialAnswers: messages(rounds, cycleNumber === 1 ? ["initial", "opening", "initial_position"] : FOLLOWUP_RESPONSE_TYPES),
            crossCritiques: messages(rounds, cycleNumber === 1 ? ["critique", "cross_critique"] : FOLLOWUP_CRITIQUE_TYPES),
            responsesToCritiques: messages(rounds, cycleNumber === 1 ? ["critique_response", "rebuttal"] : FOLLOWUP_RESPONSE_TO_CRITIQUE_TYPES),
            revisedPositions: messages(rounds, cycleNumber === 1 ? ["revised_position", "revision"] : FOLLOWUP_REVISED_TYPES),
            finalSynthesis: synthesisMessages,
            moderatorVerdict: synthesisMessages.find(isVerdict) ?? null,
        },
        status: selectedState,
    };
}

function deriveSelectedCycleStateShallow(
    session: SessionDetailDTO | null,
    cycleNumber: number,
    rounds: RoundDTO[],
): DebateCycleStatus {
    const turn = session?.latest_turn;
    const active = rounds.find((round) => round.status === "running" || round.status === "queued");
    if (active) return active.status === "queued" ? "queued" : "running";
    const synthesisTypes = cycleNumber === 1 ? ORIGINAL_STAGE_DEFS[4].types : FOLLOWUP_SYNTHESIS_TYPES;
    const hasSynthesis = hasUsableMessages(rounds, synthesisTypes);
    const hasPartial = rounds.some((round) => round.status === "failed" || round.status === "partially_completed");
    if (hasSynthesis) return hasPartial ? "partially_completed" : "completed";
    if (rounds.some((round) => round.messages.some(isUsableMessage))) return "partially_completed";
    if (cycleNumber === latestCycleNumber(session) && turn?.status === "failed") return "failed";
    return "queued";
}
