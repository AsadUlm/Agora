import type {
    SessionDetailDTO,
    RoundDTO,
    AgentDTO,
    MessageDTO,
} from "../api/debate.types";
import { deriveSelectedCycleState, getSelectedCycle, type DebateCycleStatus } from "./debate-cycle.selectors";

export type DebateStageStatus = "queued" | "running" | "partially_completed" | "completed" | "failed" | "idle";
export type RelationshipMappingSource = "explicit_ids" | "circular_order" | "payload_text" | "fallback";

export interface InitialAnswerItem {
    id: string;
    agentId: string;
    agentName: string;
    role: string;
    model?: string;
    colorKey?: string;
    stance?: string;
    summary: string;
    fullText: string;
    payload: Record<string, unknown>;
}

export interface CritiqueThreadItem {
    id: string;
    sourceAgentId: string;
    sourceAgentName: string;
    targetAgentId: string;
    targetAgentName: string;
    targetClaim?: string;
    challengeSummary: string;
    weaknessFound?: string;
    assumptionAttacked?: string;
    whyItBreaks?: string;
    counterargument?: string;
    realWorldImplication?: string;
    fullText: string;
    confidence?: string;
    mappingSource: RelationshipMappingSource;
}

export interface CritiqueResponseItem {
    id: string;
    respondingAgentId: string;
    respondingAgentName: string;
    respondingToAgentId: string;
    respondingToAgentName: string;
    sourceCritiqueId?: string;
    challengeReceived?: string;
    responseSummary: string;
    acceptedPoints?: string[];
    rejectedPoints?: string[];
    plannedRevision?: string;
    fullText: string;
    mappingSource: RelationshipMappingSource;
}

export interface RevisedPositionItem {
    id: string;
    agentId: string;
    agentName: string;
    revisedAfterCritiqueFromAgentId?: string;
    revisedAfterCritiqueFromAgentName?: string;
    initialSummary?: string;
    critiqueReceived?: string;
    revisedSummary: string;
    changeLabel: "Changed" | "Partially changed" | "Strengthened" | "Unchanged" | "Unclear";
    reasonForChange?: string;
    confidence?: string;
    fullText: string;
    mappingSource: RelationshipMappingSource;
    isInferred?: boolean;
}

export interface AgentSynthesisItem {
    id: string;
    agentId: string;
    agentName: string;
    finalPosition: string;
    takeaway?: string;
    summary?: string;
    winningArgument?: string;
    losingArgument?: string;
    confidence?: string;
    fullText: string;
}

export interface ModeratorVerdictItem {
    id: string;
    title: string;
    oneSentenceTakeaway?: string;
    recommendedAnswer: string;
    consensusStatement?: string;
    mainDisagreement?: string;
    winningSide?: string;
    confidence?: string;
    unresolvedQuestions?: string[];
    tradeoffs?: string[];
    howReached?: string[];
    fullText: string;
    payload?: Record<string, unknown>;
}

export interface ModeratorVerdictSource {
    location: string;
    messageId?: string;
    roundId?: string;
    messageType?: string;
    senderType?: string;
    fallbackExtractionUsed: boolean;
}

export interface DebateProcessModel {
    cycleNumber: number;
    cycleType: "original" | "followup";
    cycleTitle: string;
    cycleStatus: DebateCycleStatus;
    question: string;
    agents: AgentDTO[];
    round1: {
        status: DebateStageStatus;
        initialAnswers: InitialAnswerItem[];
    };
    round2: {
        status: DebateStageStatus;
        crossCritiques: CritiqueThreadItem[];
        responsesToCritiques: CritiqueResponseItem[];
        revisedPositions: RevisedPositionItem[];
    };
    round3: {
        status: DebateStageStatus;
        agentSyntheses: AgentSynthesisItem[];
        moderatorVerdict: ModeratorVerdictItem | null;
        howReached: string[];
    };
    diagnostics: {
        hasStage1: boolean;
        hasStage2: boolean;
        hasStage3: boolean;
        hasStage4: boolean;
        hasStage5: boolean;
        hasResponseToCritique: boolean;
        hasRevisedPosition: boolean;
        missingRelationshipMetadata: boolean;
        fallbackModeUsed: boolean;
        stage1Count: number;
        stage2Count: number;
        stage3Count: number;
        stage4Count: number;
        stage5Count: number;
        stageStatuses: {
            stage1: DebateStageStatus;
            stage2: DebateStageStatus;
            stage3: DebateStageStatus;
            stage4: DebateStageStatus;
            stage5: DebateStageStatus;
        };
        relationshipMappingMode: RelationshipMappingSource;
        agentOrder: string[];
        expectedStage2: string[];
        expectedStage3: string[];
        actualStage2: string[];
        actualStage3: string[];
        actualStage4: string[];
        mappingDetails: Array<{
            stage: 2 | 3 | 4;
            relation: string;
            mappingSource: RelationshipMappingSource;
            payloadHint?: string;
        }>;
        round3: {
            stage5Status: DebateStageStatus;
            agentSynthesisMessages: number;
            moderatorVerdictFound: boolean;
            moderatorVerdictSource: ModeratorVerdictSource | null;
            fallbackExtractionUsed: boolean;
        };
    };
}

const CHANGE_TYPE_LABEL: Record<string, RevisedPositionItem["changeLabel"]> = {
    narrowed_position: "Partially changed",
    expanded_position: "Strengthened",
    changed_stance: "Changed",
    added_condition: "Strengthened",
    resolved_uncertainty: "Strengthened",
    other: "Changed",
};

type AgentMessage = RoundDTO["messages"][number];
type UnknownRecord = Record<string, unknown>;

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const result = text(value);
        if (result) return result;
    }
    return "";
}

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function parseJsonRecord(value: unknown): UnknownRecord | null {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        return asRecord(JSON.parse(value));
    } catch {
        return null;
    }
}

function stringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map((item) => text(item))
            .filter(Boolean);
    }
    const single = text(value);
    return single ? [single] : [];
}

function readablePayloadText(payload: UnknownRecord, rawText = ""): string {
    const takeaway = firstText(payload.one_sentence_takeaway);
    const summary = firstText(payload.short_summary, payload.summary);
    const combinedTakeaway = takeaway && summary && takeaway !== summary
        ? `${takeaway}\n\n${summary}`
        : takeaway || summary;

    const direct = firstText(
        payload.response,
        payload.recommended_answer,
        payload.final_answer,
        payload.final_position,
        combinedTakeaway,
        payload.conclusion,
        payload.answer,
    );
    if (direct) return direct;

    const parsedRaw = parseJsonRecord(rawText);
    if (parsedRaw) {
        const parsedReadable = readablePayloadText(parsedRaw);
        if (parsedReadable) return parsedReadable;
        const usefulValues = Object.entries(parsedRaw)
            .filter(([key]) => ![
                "message_type",
                "agent_role",
                "generation_status",
                "parse_status",
                "parse_warnings",
                "is_fallback",
            ].includes(key))
            .flatMap(([, value]) => stringList(value));
        return usefulValues.join("\n");
    }

    return text(rawText);
}

export function getReadableMessageText(message: MessageDTO): string {
    return readablePayloadText(message.payload ?? {}, message.text);
}

function hasVerdictFields(payload: UnknownRecord): boolean {
    return [
        "recommended_answer",
        "final_answer",
        "final_position",
        "conclusion",
        "answer",
        "recommendation",
        "verdict",
        "synthesis",
        "one_sentence_takeaway",
        "consensus_statement",
        "main_disagreement",
        "winning_side",
        "reasoning_basis",
        "response",
    ].some((key) => {
        const value = payload[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(text(value));
    });
}

function unwrapVerdictPayload(value: unknown): UnknownRecord {
    const root = asRecord(value) ?? {};
    for (const key of [
        "moderatorVerdict",
        "moderator_verdict",
        "synthesis_verdict",
        "verdict",
        "final_summary",
    ]) {
        const nested = asRecord(root[key]);
        if (nested) return { ...root, ...nested };
    }
    return root;
}

function looksLikeModeratorVerdict(value: unknown): boolean {
    const payload = unwrapVerdictPayload(value);
    const discriminator = firstText(payload.message_type, payload.agent_role, payload.title).toLowerCase();
    return discriminator.includes("moderator")
        || discriminator.includes("synthesis_verdict")
        || Boolean(firstText(payload.recommended_answer))
        || Boolean(firstText(payload.consensus_statement) && firstText(payload.main_disagreement));
}

function isVerdictMessage(message: MessageDTO): boolean {
    const payload = message.payload ?? {};
    const messageType = message.message_type.toLowerCase();
    const senderType = message.sender_type.toLowerCase();
    const role = firstText(message.agent_role, payload.agent_role, payload.title).toLowerCase();
    const innerType = firstText(payload.message_type).toLowerCase();
    const verdictLikePayload = hasVerdictFields(payload)
        || ["moderator_verdict", "synthesis_verdict"].includes(innerType);

    return senderType === "judge"
        || role.includes("moderator")
        || role.includes("judge")
        || ["judge", "moderator_verdict", "synthesis_verdict"].includes(messageType)
        || (senderType === "system" && verdictLikePayload)
        || (message.agent_id === null && (messageType === "final_summary" || verdictLikePayload));
}

function normalizeModeratorVerdict(
    id: string,
    payloadValue: unknown,
    rawText: string,
): ModeratorVerdictItem | null {
    const payload = unwrapVerdictPayload(asRecord(payloadValue) ?? parseJsonRecord(rawText) ?? {});
    if (firstText(payload.generation_status).toLowerCase() === "failed" && !hasVerdictFields(payload)) {
        return null;
    }
    const recommendedAnswer = firstText(
        payload.recommended_answer,
        payload.final_answer,
        payload.conclusion,
        payload.answer,
        payload.recommendation,
        payload.verdict,
        payload.synthesis,
        payload.one_sentence_takeaway,
        readablePayloadText(payload, rawText),
    );
    if (!recommendedAnswer) return null;

    const fullText = firstText(
        payload.response,
        payload.full_text,
        payload.narrative,
        readablePayloadText(payload, rawText),
        recommendedAnswer,
    );

    return {
        id,
        title: firstText(payload.title) || "Final Verdict",
        oneSentenceTakeaway: firstText(payload.one_sentence_takeaway) || undefined,
        recommendedAnswer,
        consensusStatement: firstText(payload.consensus_statement, payload.consensus, payload.agreement, payload.core_consensus) || undefined,
        mainDisagreement: firstText(payload.main_disagreement, payload.disagreement, payload.key_disagreement, payload.primary_disagreement) || undefined,
        winningSide: firstText(payload.winning_side, payload.winner) || undefined,
        confidence: firstText(payload.confidence, payload.confidence_level, payload.decision_confidence) || undefined,
        unresolvedQuestions: stringList(payload.unresolved_questions ?? payload.open_questions ?? payload.remaining_questions),
        tradeoffs: stringList(payload.tradeoffs ?? payload.risk_tradeoffs ?? payload.core_tradeoff),
        howReached: stringList(
            payload.reasoning_path
            ?? payload.how_reached
            ?? payload.decision_rationale
            ?? payload.reasoning_basis,
        ),
        fullText,
        payload,
    };
}

export function extractModeratorVerdict(
    session: SessionDetailDTO,
    cycleNumber = 1,
): { verdict: ModeratorVerdictItem | null; source: ModeratorVerdictSource | null } {
    const turn = session.latest_turn;
    if (!turn) return { verdict: null, source: null };

    const baseRounds = turn.rounds
        .filter((round) => cycleNumber === 1
            ? (round.cycle_number ?? 1) === 1
            : round.cycle_number === cycleNumber)
        .sort((a, b) => {
            const aFinal = a.round_type === "final" ? 1 : 0;
            const bFinal = b.round_type === "final" ? 1 : 0;
            return bFinal - aFinal || b.round_number - a.round_number;
        });

    for (const round of baseRounds) {
        const messages = [...round.messages].sort((a, b) => {
            const aJudge = a.sender_type === "judge" ? 1 : 0;
            const bJudge = b.sender_type === "judge" ? 1 : 0;
            return bJudge - aJudge || b.sequence_no - a.sequence_no;
        });
        for (const message of messages) {
            if (!isVerdictMessage(message)) continue;
            const verdict = normalizeModeratorVerdict(message.id, message.payload, message.text);
            if (!verdict) continue;
            return {
                verdict,
                source: {
                    location: "stage5_message",
                    messageId: message.id,
                    roundId: round.id,
                    messageType: message.message_type,
                    senderType: message.sender_type,
                    fallbackExtractionUsed: false,
                },
            };
        }
    }

    const turnRecord = turn as unknown as UnknownRecord;
    const sessionRecord = session as unknown as UnknownRecord;
    const finalRoundRecord = baseRounds.find((round) => round.round_type === "final") as unknown as UnknownRecord | undefined;
    const fallbackCandidates: Array<{ location: string; value: unknown }> = cycleNumber === 1 ? [
        { location: "turn.final_summary", value: turn.final_summary },
        { location: "turn.synthesis_verdict", value: turnRecord.synthesis_verdict },
        { location: "turn.moderatorVerdict", value: turnRecord.moderatorVerdict },
        { location: "turn.verdict", value: turnRecord.verdict },
        { location: "round.synthesis_verdict", value: finalRoundRecord?.synthesis_verdict },
        { location: "round.moderatorVerdict", value: finalRoundRecord?.moderatorVerdict },
        { location: "round.verdict", value: finalRoundRecord?.verdict },
        { location: "session.synthesis_verdict", value: sessionRecord.synthesis_verdict },
        { location: "session.moderatorVerdict", value: sessionRecord.moderatorVerdict },
        { location: "session.verdict", value: sessionRecord.verdict },
    ] : [];

    for (const candidate of fallbackCandidates) {
        if (candidate.value == null) continue;
        if (candidate.location === "turn.final_summary" && !looksLikeModeratorVerdict(candidate.value)) {
            continue;
        }
        const rawText = typeof candidate.value === "string" ? candidate.value : "";
        const verdict = normalizeModeratorVerdict(candidate.location, candidate.value, rawText);
        if (!verdict) continue;
        return {
            verdict,
            source: {
                location: candidate.location,
                fallbackExtractionUsed: true,
            },
        };
    }

    return { verdict: null, source: null };
}

function orderedAgents(agents: AgentDTO[]): AgentDTO[] {
    return agents
        .map((agent, inputIndex) => ({ agent, inputIndex }))
        .sort((a, b) => {
            const aOrder = a.agent.position_order;
            const bOrder = b.agent.position_order;
            if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
            if (aOrder != null && bOrder == null) return -1;
            if (aOrder == null && bOrder != null) return 1;
            return a.inputIndex - b.inputIndex;
        })
        .map(({ agent }) => agent);
}

function findAgentById(agents: AgentDTO[], value: unknown): AgentDTO | undefined {
    const id = text(value);
    return id ? agents.find((agent) => agent.id === id) : undefined;
}

function findAgentByText(agents: AgentDTO[], value: unknown): AgentDTO | undefined {
    const hint = text(value).toLowerCase();
    return hint
        ? agents.find((agent) => agent.id.toLowerCase() === hint || agent.role.toLowerCase() === hint)
        : undefined;
}

function agentForMessage(agents: AgentDTO[], message?: AgentMessage): AgentDTO | undefined {
    if (!message) return undefined;
    return findAgentById(agents, message.agent_id) ?? findAgentByText(agents, message.agent_role);
}

function agentMessages(round?: RoundDTO): AgentMessage[] {
    return round?.messages.filter((message) => message.sender_type === "agent" && Boolean(message.agent_role)) ?? [];
}

function hasOneMessagePerAgent(round: RoundDTO | undefined, agents: AgentDTO[]): boolean {
    const messages = agentMessages(round);
    if (!round || messages.length !== agents.length) return false;
    return agents.every((agent) =>
        messages.filter((message) => message.agent_id === agent.id || message.agent_role === agent.role).length === 1,
    );
}

function circularNeighbor(agents: AgentDTO[], agent: AgentDTO, offset: -1 | 1): AgentDTO | undefined {
    const index = agents.findIndex((candidate) => candidate.id === agent.id);
    if (index < 0 || agents.length === 0) return undefined;
    return agents[(index + offset + agents.length) % agents.length];
}

function resolveMappingMode(sources: RelationshipMappingSource[]): RelationshipMappingSource {
    if (sources.includes("circular_order")) return "circular_order";
    if (sources.includes("explicit_ids")) return "explicit_ids";
    if (sources.includes("payload_text")) return "payload_text";
    return "fallback";
}

export function buildDebateProcessModel(session: SessionDetailDTO | null, selectedCycleNumber = 1): DebateProcessModel {
    const agents = orderedAgents(session?.agents ?? []);
    const cycle = getSelectedCycle(session, selectedCycleNumber);
    const cycleState = deriveSelectedCycleState(session, selectedCycleNumber);
    const defaultModel: DebateProcessModel = {
        cycleNumber: cycle.cycleNumber,
        cycleType: cycle.cycleType,
        cycleTitle: cycle.title,
        cycleStatus: cycleState.status,
        question: cycle.question,
        agents,
        round1: { status: "idle", initialAnswers: [] },
        round2: { status: "idle", crossCritiques: [], responsesToCritiques: [], revisedPositions: [] },
        round3: { status: "idle", agentSyntheses: [], moderatorVerdict: null, howReached: [] },
        diagnostics: {
            hasStage1: false,
            hasStage2: false,
            hasStage3: false,
            hasStage4: false,
            hasStage5: false,
            hasResponseToCritique: false,
            hasRevisedPosition: false,
            missingRelationshipMetadata: false,
            fallbackModeUsed: false,
            stage1Count: 0,
            stage2Count: 0,
            stage3Count: 0,
            stage4Count: 0,
            stage5Count: 0,
            stageStatuses: {
                stage1: "idle",
                stage2: "idle",
                stage3: "idle",
                stage4: "idle",
                stage5: "idle",
            },
            relationshipMappingMode: "fallback",
            agentOrder: agents.map((agent) => agent.role),
            expectedStage2: [],
            expectedStage3: [],
            actualStage2: [],
            actualStage3: [],
            actualStage4: [],
            mappingDetails: [],
            round3: {
                stage5Status: "idle",
                agentSynthesisMessages: 0,
                moderatorVerdictFound: false,
                moderatorVerdictSource: null,
                fallbackExtractionUsed: false,
            },
        },
    };

    if (!session || !session.latest_turn) return defaultModel;

    const turn = session.latest_turn;
    const trace = cycle.cycleType === "original" ? turn.debate_trace : null;
    const rounds = cycle.rounds;

    const findRound = (types: string[]) =>
        rounds.find((round) => types.includes(round.round_type));

    const isFollowup = cycle.cycleType === "followup";
    const round1Obj = findRound(isFollowup ? ["followup_response"] : ["initial", "opening", "initial_position"]);
    const round2Obj = findRound(isFollowup ? ["followup_cross_critique", "followup_critique"] : ["critique", "cross_critique"]);
    const round3Obj = findRound(isFollowup ? ["followup_response_to_critique"] : ["critique_response", "rebuttal"]);
    const round4Obj = findRound(isFollowup ? ["followup_revised_position"] : ["revised_position", "revision"]);
    const round5Obj = findRound(isFollowup ? ["updated_synthesis"] : ["final", "synthesis", "final_synthesis"]);

    const mapStatus = (round?: RoundDTO): DebateStageStatus => {
        if (!round) return "idle";
        return (round.status as DebateStageStatus) ?? "idle";
    };
    const combineStatuses = (items: Array<RoundDTO | undefined>): DebateStageStatus => {
        const statuses = items.filter(Boolean).map((round) => mapStatus(round));
        if (statuses.length === 0) return "idle";
        if (statuses.includes("running")) return "running";
        if (statuses.includes("queued")) return "queued";
        if (statuses.includes("partially_completed")) return "partially_completed";
        if (statuses.includes("failed") && statuses.some((status) => status === "completed")) {
            return "partially_completed";
        }
        if (statuses.includes("failed")) return "failed";
        if (statuses.every((status) => status === "completed")) return "completed";
        return "idle";
    };
    const round2Status = combineStatuses([round2Obj, round3Obj, round4Obj]);

    // Diagnostics message counting
    const stage1Count = round1Obj?.messages.length ?? 0;
    const stage2Count = round2Obj?.messages.length ?? 0;
    const stage3Count = round3Obj?.messages.length ?? 0;
    const stage4Count = round4Obj?.messages.length ?? 0;
    const stage5Count = round5Obj?.messages.length ?? 0;

    const hasStage1 = stage1Count > 0;
    const hasStage2 = stage2Count > 0;
    const hasStage3 = stage3Count > 0;
    const hasStage4 = stage4Count > 0;
    const hasStage5 = stage5Count > 0;
    const circularOrderAvailable =
        agents.length >= 3
        && hasOneMessagePerAgent(round2Obj, agents)
        && hasOneMessagePerAgent(round3Obj, agents)
        && hasOneMessagePerAgent(round4Obj, agents);

    const expectedStage2 = agents.map((sourceAgent) => {
        const targetAgent = circularNeighbor(agents, sourceAgent, 1);
        return `${sourceAgent.role} -> ${targetAgent?.role ?? "Unknown"}`;
    });
    const expectedStage3 = agents.map((sourceAgent) => {
        const respondingAgent = circularNeighbor(agents, sourceAgent, 1);
        return `${respondingAgent?.role ?? "Unknown"} -> ${sourceAgent.role}`;
    });

    // 1. Initial Answers
    const initialAnswers: InitialAnswerItem[] = [];
    if (round1Obj) {
        for (const msg of agentMessages(round1Obj)) {
            if (!msg.agent_role) continue;
            const agent = agentForMessage(agents, msg);
            const payload = msg.payload ?? {};
            const stance = firstText(payload.stance, payload.stance_summary);
            const summary = firstText(payload.short_summary, payload.main_argument, msg.text).slice(0, 300);
            initialAnswers.push({
                id: msg.id,
                agentId: agent?.id ?? msg.agent_id ?? "",
                agentName: agent?.role ?? msg.agent_role,
                role: agent?.role ?? msg.agent_role,
                model: agent?.model,
                stance: stance || undefined,
                summary,
                fullText: msg.text,
                payload,
            });
        }
    }
    initialAnswers.sort((a, b) =>
        agents.findIndex((agent) => agent.id === a.agentId) - agents.findIndex((agent) => agent.id === b.agentId),
    );

    // 2. Cross-Critiques
    const crossCritiques: CritiqueThreadItem[] = [];
    let missingRelationshipMetadata = false;
    let fallbackModeUsed = false;
    const stage2Messages = agentMessages(round2Obj);
    const stage2Records = stage2Messages.length > 0
        ? stage2Messages.map((message) => ({
            message,
            critique: trace?.critiques.find((item) =>
                item.from_agent_id === message.agent_id || item.from_agent_name === message.agent_role,
            ),
        }))
        : (trace?.critiques ?? []).map((critique) => ({ message: undefined, critique }));

    for (const { message, critique } of stage2Records) {
        const payload = message?.payload ?? {};
        const sourceAgent =
            findAgentById(agents, payload.source_agent_id)
            ?? agentForMessage(agents, message)
            ?? findAgentById(agents, critique?.from_agent_id)
            ?? findAgentByText(agents, critique?.from_agent_name);
        if (!sourceAgent) continue;

        const explicitTargetCandidate = findAgentById(
            agents,
            firstText(payload.target_agent_id, payload.to_agent_id),
        );
        const explicitTarget = explicitTargetCandidate?.id !== sourceAgent.id
            ? explicitTargetCandidate
            : undefined;
        const circularTarget = circularOrderAvailable
            ? circularNeighbor(agents, sourceAgent, 1)
            : undefined;
        const payloadTargetHint = firstText(
            payload.target_agent,
            payload.target_role,
            payload.challenged_agent,
            payload.critique_target,
            critique?.to_agent_name,
        );
        const payloadTarget = findAgentByText(agents, payloadTargetHint);

        const targetAgent = explicitTarget ?? circularTarget ?? payloadTarget;
        const mappingSource: RelationshipMappingSource = explicitTarget
            ? "explicit_ids"
            : circularTarget
                ? "circular_order"
                : payloadTarget
                    ? "payload_text"
                    : "fallback";

        if (mappingSource === "fallback") {
            fallbackModeUsed = true;
            missingRelationshipMetadata = true;
        }

        const challengeSummary = firstText(
            critique?.critique_summary,
            payload.critique_summary,
            payload.short_summary,
            payload.summary,
            payload.response,
            message?.text,
        ).slice(0, 300);

        crossCritiques.push({
            id: critique?.id ?? message?.id ?? `critique-${sourceAgent.id}`,
            sourceAgentId: sourceAgent.id,
            sourceAgentName: sourceAgent.role,
            targetAgentId: targetAgent?.id ?? "",
            targetAgentName: targetAgent?.role ?? (payloadTargetHint || "Unknown target"),
            targetClaim: firstText(critique?.target_claim, payload.target_claim, payload.challenged_claim, payload.challenge) || undefined,
            challengeSummary,
            weaknessFound: firstText(critique?.weakness_found, payload.weakness_found) || undefined,
            assumptionAttacked: firstText(payload.assumption_attacked) || undefined,
            whyItBreaks: firstText(payload.why_it_breaks) || undefined,
            counterargument: firstText(payload.counterargument) || undefined,
            realWorldImplication: firstText(payload.real_world_implication) || undefined,
            fullText: firstText(message?.text, challengeSummary),
            confidence: firstText(payload.confidence) || undefined,
            mappingSource,
        });
    }
    crossCritiques.sort((a, b) =>
        agents.findIndex((agent) => agent.id === a.sourceAgentId) - agents.findIndex((agent) => agent.id === b.sourceAgentId),
    );

    // 3. Responses to Critiques
    const responsesToCritiques: CritiqueResponseItem[] = [];
    const stage3Messages = agentMessages(round3Obj);
    const stage3Records = stage3Messages.length > 0
        ? stage3Messages.map((message) => ({
            message,
            response: trace?.critique_responses.find((item) =>
                item.agent_id === message.agent_id || item.agent_name === message.agent_role,
            ),
        }))
        : (trace?.critique_responses ?? []).map((response) => ({ message: undefined, response }));

    for (const { message, response } of stage3Records) {
        const payload = message?.payload ?? {};
        const respondingAgent =
            agentForMessage(agents, message)
            ?? findAgentById(agents, response?.agent_id)
            ?? findAgentByText(agents, response?.agent_name);
        if (!respondingAgent) continue;

        const sourceCritiqueId = firstText(payload.source_critique_id, payload.critique_id);
        const explicitlyLinkedCritique = sourceCritiqueId
            ? crossCritiques.find((item) => item.id === sourceCritiqueId)
            : undefined;
        const explicitRespondingToCandidate =
            findAgentById(agents, payload.response_to_agent_id)
            ?? (explicitlyLinkedCritique
                ? findAgentById(agents, explicitlyLinkedCritique.sourceAgentId)
                : undefined);
        const explicitRespondingTo = explicitRespondingToCandidate?.id !== respondingAgent.id
            ? explicitRespondingToCandidate
            : undefined;
        const circularRespondingTo = circularOrderAvailable
            ? circularNeighbor(agents, respondingAgent, -1)
            : undefined;
        const linkedCritique = crossCritiques.find((item) => item.targetAgentId === respondingAgent.id);
        const linkedCritic = linkedCritique
            ? findAgentById(agents, linkedCritique.sourceAgentId)
            : undefined;
        const explicitLinkedCritic = linkedCritique?.mappingSource === "explicit_ids"
            ? linkedCritic
            : undefined;
        const payloadRespondingToHint = firstText(
            payload.responding_to_agent,
            payload.response_to_agent,
            payload.source_critic,
            payload.critic_agent,
        );
        const payloadRespondingTo = findAgentByText(agents, payloadRespondingToHint);

        const respondingToAgent =
            explicitRespondingTo
            ?? explicitLinkedCritic
            ?? circularRespondingTo
            ?? linkedCritic
            ?? payloadRespondingTo;
        const mappingSource: RelationshipMappingSource = explicitRespondingTo
            ? "explicit_ids"
            : explicitLinkedCritic
                ? "explicit_ids"
                : circularRespondingTo
                    ? "circular_order"
                    : linkedCritic
                        ? linkedCritique?.mappingSource ?? "payload_text"
                        : payloadRespondingTo
                            ? "payload_text"
                            : "fallback";
        const sourceCritique =
            explicitlyLinkedCritique
            ?? crossCritiques.find((item) =>
                item.sourceAgentId === respondingToAgent?.id && item.targetAgentId === respondingAgent.id,
            )
            ?? linkedCritique;

        if (mappingSource === "fallback") {
            fallbackModeUsed = true;
            missingRelationshipMetadata = true;
        }

        const responseSummary = firstText(response?.response, payload.response, payload.summary, message?.text).slice(0, 300);
        responsesToCritiques.push({
            id: response?.id ?? message?.id ?? `response-${respondingAgent.id}`,
            respondingAgentId: respondingAgent.id,
            respondingAgentName: respondingAgent.role,
            respondingToAgentId: respondingToAgent?.id ?? "",
            respondingToAgentName: respondingToAgent?.role ?? (payloadRespondingToHint || "Unknown critic"),
            sourceCritiqueId: sourceCritique?.id,
            challengeReceived: firstText(
                sourceCritique?.challengeSummary,
                response?.received_critique_summary,
                payload.received_critique_summary,
                payload.challenge,
            ) || undefined,
            responseSummary,
            acceptedPoints: response?.accepted_points
                ?? (Array.isArray(payload.accepted_points) ? payload.accepted_points.map(String) : []),
            rejectedPoints: response?.rejected_points
                ?? (Array.isArray(payload.rejected_points) ? payload.rejected_points.map(String) : []),
            plannedRevision: firstText(response?.planned_revision, payload.planned_revision) || undefined,
            fullText: firstText(message?.text, responseSummary),
            mappingSource,
        });
    }
    responsesToCritiques.sort((a, b) => {
        const aIndex = agents.findIndex((agent) => agent.id === a.respondingToAgentId);
        const bIndex = agents.findIndex((agent) => agent.id === b.respondingToAgentId);
        return aIndex - bIndex;
    });

    // 4. Revised Positions
    const revisedPositions: RevisedPositionItem[] = [];
    const stage4Messages = agentMessages(round4Obj);
    const stage4Records = stage4Messages.length > 0
        ? stage4Messages.map((message) => ({
            message,
            revision: trace?.revised_positions.find((item) =>
                item.agent_id === message.agent_id || item.agent_name === message.agent_role,
            ),
        }))
        : (trace?.revised_positions ?? []).map((revision) => ({ message: undefined, revision }));

    for (const { message, revision } of stage4Records) {
        const payload = message?.payload ?? {};
        const agent =
            agentForMessage(agents, message)
            ?? findAgentById(agents, revision?.agent_id)
            ?? findAgentByText(agents, revision?.agent_name);
        if (!agent) continue;

        const explicitCriticCandidate = findAgentById(
            agents,
            firstText(
                payload.received_critique_from_agent_id,
                payload.critique_from_agent_id,
                payload.response_to_agent_id,
            ),
        );
        const explicitCritic = explicitCriticCandidate?.id !== agent.id
            ? explicitCriticCandidate
            : undefined;
        const circularCritic = circularOrderAvailable
            ? circularNeighbor(agents, agent, -1)
            : undefined;
        const receivedCritique = crossCritiques.find((item) => item.targetAgentId === agent.id);
        const linkedCritic = receivedCritique
            ? findAgentById(agents, receivedCritique.sourceAgentId)
            : undefined;
        const explicitLinkedCritic = receivedCritique?.mappingSource === "explicit_ids"
            ? linkedCritic
            : undefined;
        const payloadCriticHint = firstText(
            payload.received_critique_from_agent,
            payload.critique_from_agent,
            payload.responding_to_agent,
        );
        const payloadCritic = findAgentByText(agents, payloadCriticHint);

        const critic = explicitCritic ?? explicitLinkedCritic ?? circularCritic ?? linkedCritic ?? payloadCritic;
        const mappingSource: RelationshipMappingSource = explicitCritic
            ? "explicit_ids"
            : explicitLinkedCritic
                ? "explicit_ids"
                : circularCritic
                    ? "circular_order"
                    : linkedCritic
                        ? receivedCritique?.mappingSource ?? "payload_text"
                        : payloadCritic
                            ? "payload_text"
                            : "fallback";
        const matchingCritique =
            crossCritiques.find((item) => item.sourceAgentId === critic?.id && item.targetAgentId === agent.id)
            ?? receivedCritique;
        const initialAnswer = initialAnswers.find((item) => item.agentId === agent.id);
        const changed =
            revision?.changed
            ?? (payload.changed === true || text(payload.change_type) !== "");
        const changeType = firstText(revision?.change_type, payload.change_type);
        const changeLabel = !changed ? "Unchanged" : CHANGE_TYPE_LABEL[changeType] ?? "Changed";
        const revisedSummary = firstText(
            revision?.revised_position,
            revision?.change_summary,
            payload.revised_position,
            payload.response,
            message?.text,
        ).slice(0, 300);

        if (mappingSource === "fallback") {
            fallbackModeUsed = true;
            missingRelationshipMetadata = true;
        }

        revisedPositions.push({
            id: revision?.id ?? message?.id ?? `revision-${agent.id}`,
            agentId: agent.id,
            agentName: agent.role,
            revisedAfterCritiqueFromAgentId: critic?.id,
            revisedAfterCritiqueFromAgentName: critic?.role ?? (payloadCriticHint || undefined),
            initialSummary: firstText(revision?.initial_position_summary, payload.initial_position, payload.before, initialAnswer?.summary) || undefined,
            critiqueReceived: firstText(
                matchingCritique?.challengeSummary,
                payload.received_critique_summary,
                Array.isArray(payload.received_critiques_summary)
                    ? payload.received_critiques_summary.join("; ")
                    : payload.received_critiques_summary,
            ) || undefined,
            revisedSummary,
            changeLabel,
            reasonForChange: firstText(revision?.reason_for_change, payload.reason_for_change, payload.why_changed) || undefined,
            confidence: firstText(payload.confidence) || undefined,
            fullText: firstText(message?.text, revisedSummary),
            mappingSource,
        });
    }

    if (hasStage5 && !hasStage4 && revisedPositions.length === 0) {
        // Infer from initial answers
        for (const ans of initialAnswers) {
            revisedPositions.push({
                id: `inferred-${ans.agentId}`,
                agentId: ans.agentId,
                agentName: ans.agentName,
                initialSummary: ans.summary,
                revisedSummary: ans.summary,
                changeLabel: "Unchanged",
                reasonForChange: "No revised position submitted. Stance remains unchanged.",
                fullText: ans.fullText,
                mappingSource: "fallback",
                isInferred: true,
            });
        }
    }
    revisedPositions.sort((a, b) =>
        agents.findIndex((agent) => agent.id === a.agentId) - agents.findIndex((agent) => agent.id === b.agentId),
    );

    // 5. Agent Syntheses & Verdict
    const agentSyntheses: AgentSynthesisItem[] = [];
    if (round5Obj) {
        for (const msg of round5Obj.messages) {
            if (msg.sender_type !== "agent" || !msg.agent_id || !msg.agent_role) continue;
            const payload = msg.payload ?? {};
            const readableText = getReadableMessageText(msg);
            const finalPosition = firstText(
                payload.final_position,
                payload.recommended_answer,
                payload.response,
                payload.one_sentence_takeaway,
                payload.short_summary,
                readableText,
            );
            agentSyntheses.push({
                id: msg.id,
                agentId: msg.agent_id,
                agentName: msg.agent_role,
                takeaway: firstText(payload.one_sentence_takeaway) || undefined,
                summary: firstText(payload.short_summary, payload.summary) || undefined,
                finalPosition,
                winningArgument: firstText(payload.winning_argument, payload.strongest_surviving_argument) || undefined,
                losingArgument: firstText(payload.losing_argument, payload.weakest_defended_assumption) || undefined,
                confidence: firstText(payload.confidence, payload.confidence_level) || undefined,
                fullText: readableText || finalPosition,
            });
        }
    }
    agentSyntheses.sort((a, b) =>
        agents.findIndex((agent) => agent.id === a.agentId) - agents.findIndex((agent) => agent.id === b.agentId),
    );

    const round3Status: DebateStageStatus = isFollowup
        ? mapStatus(round5Obj)
        : turn.synthesis_status === "failed"
        ? "failed"
        : turn.synthesis_status === "running"
            ? "running"
            : mapStatus(round5Obj);
    const verdictExtraction = extractModeratorVerdict(session, cycle.cycleNumber);
    const moderatorVerdict = verdictExtraction.verdict;
    const generatedHowReached = isFollowup ? [
        "Agents answered the follow-up using the earlier debate as context.",
        "Follow-up critiques tested the new responses.",
        "The moderator updated the synthesis for this follow-up cycle.",
    ] : [
        "Agents first proposed different positions.",
        "Cross-critiques tested weak assumptions.",
        "Agents responded and revised their positions.",
        "The moderator consolidated the strongest surviving arguments.",
    ];
    const howReached = moderatorVerdict?.howReached?.length
        ? moderatorVerdict.howReached
        : generatedHowReached;
    if (moderatorVerdict) moderatorVerdict.howReached = howReached;

    return {
        cycleNumber: cycle.cycleNumber,
        cycleType: cycle.cycleType,
        cycleTitle: cycle.title,
        cycleStatus: cycleState.status,
        question: cycle.question,
        agents,
        round1: { status: mapStatus(round1Obj), initialAnswers },
        round2: {
            status: round2Status,
            crossCritiques,
            responsesToCritiques,
            revisedPositions,
        },
        round3: { status: round3Status, agentSyntheses, moderatorVerdict, howReached },
        diagnostics: {
            hasStage1,
            hasStage2,
            hasStage3,
            hasStage4,
            hasStage5,
            hasResponseToCritique: hasStage3,
            hasRevisedPosition: hasStage4,
            missingRelationshipMetadata,
            fallbackModeUsed,
            stage1Count,
            stage2Count,
            stage3Count,
            stage4Count,
            stage5Count,
            stageStatuses: {
                stage1: mapStatus(round1Obj),
                stage2: mapStatus(round2Obj),
                stage3: mapStatus(round3Obj),
                stage4: mapStatus(round4Obj),
                stage5: mapStatus(round5Obj),
            },
            relationshipMappingMode: resolveMappingMode([
                ...crossCritiques.map((item) => item.mappingSource),
                ...responsesToCritiques.map((item) => item.mappingSource),
                ...revisedPositions.map((item) => item.mappingSource),
            ]),
            agentOrder: agents.map((agent) => agent.role),
            expectedStage2,
            expectedStage3,
            actualStage2: crossCritiques.map((item) => `${item.sourceAgentName} -> ${item.targetAgentName}`),
            actualStage3: responsesToCritiques.map((item) => `${item.respondingAgentName} -> ${item.respondingToAgentName}`),
            actualStage4: revisedPositions.map((item) =>
                `${item.agentName} <- ${item.revisedAfterCritiqueFromAgentName ?? "Unknown critic"}`,
            ),
            mappingDetails: [
                ...crossCritiques.map((item) => ({
                    stage: 2 as const,
                    relation: `${item.sourceAgentName} -> ${item.targetAgentName}`,
                    mappingSource: item.mappingSource,
                    payloadHint: stage2Records.find(({ message, critique }) =>
                        message?.id === item.id || critique?.id === item.id,
                    )?.message
                        ? firstText(
                            stage2Records.find(({ message, critique }) =>
                                message?.id === item.id || critique?.id === item.id,
                            )?.message?.payload.target_agent,
                            stage2Records.find(({ message, critique }) =>
                                message?.id === item.id || critique?.id === item.id,
                            )?.message?.payload.target_role,
                            stage2Records.find(({ message, critique }) =>
                                message?.id === item.id || critique?.id === item.id,
                            )?.critique?.to_agent_name,
                        ) || undefined
                        : undefined,
                })),
                ...responsesToCritiques.map((item) => ({
                    stage: 3 as const,
                    relation: `${item.respondingAgentName} -> ${item.respondingToAgentName}`,
                    mappingSource: item.mappingSource,
                })),
                ...revisedPositions.map((item) => ({
                    stage: 4 as const,
                    relation: `${item.agentName} <- ${item.revisedAfterCritiqueFromAgentName ?? "Unknown critic"}`,
                    mappingSource: item.mappingSource,
                })),
            ],
            round3: {
                stage5Status: round3Status,
                agentSynthesisMessages: agentSyntheses.length,
                moderatorVerdictFound: Boolean(moderatorVerdict),
                moderatorVerdictSource: verdictExtraction.source,
                fallbackExtractionUsed: verdictExtraction.source?.fallbackExtractionUsed ?? false,
            },
        },
    };
}
