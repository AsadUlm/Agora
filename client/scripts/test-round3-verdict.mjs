import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const agents = [
    {
        id: "agent-policy",
        role: "Policy Analyst",
        provider: "test",
        model: "test",
        temperature: null,
        reasoning_style: null,
        position_order: 0,
        knowledge_mode: null,
        knowledge_strict: null,
    },
];

function message(overrides) {
    return {
        id: "message",
        agent_id: null,
        agent_role: null,
        message_type: "final_summary",
        sender_type: "judge",
        payload: {},
        text: "",
        sequence_no: 1,
        created_at: "2026-06-09T00:00:00Z",
        ...overrides,
    };
}

function round(roundNumber, roundType, status, messages) {
    return {
        id: `round-${roundNumber}`,
        round_number: roundNumber,
        cycle_number: 1,
        round_type: roundType,
        status,
        started_at: null,
        ended_at: null,
        messages,
    };
}

function sessionWith({ stage5Messages, finalSummary = null, turnStatus = "completed", synthesisStatus = "completed", stage5Status = "completed" }) {
    return {
        id: "session",
        title: "Verdict test",
        question: "Should regulation be adopted?",
        status: turnStatus,
        created_at: "2026-06-09T00:00:00Z",
        updated_at: "2026-06-09T00:00:00Z",
        agents,
        latest_turn: {
            id: "turn",
            turn_index: 1,
            status: turnStatus,
            synthesis_status: synthesisStatus,
            started_at: null,
            ended_at: null,
            user_message: null,
            final_summary: finalSummary,
            rounds: [
                round(1, "initial", "completed", []),
                round(2, "critique", "completed", []),
                round(3, "critique_response", "completed", []),
                round(4, "revised_position", "completed", []),
                round(5, "final", stage5Status, stage5Messages),
            ],
            debate_trace: null,
        },
    };
}

const agentPayload = {
    one_sentence_takeaway: "Regulation is net-positive.",
    short_summary: "Use a strict risk-tiered model.",
    final_position: "Adopt regulation with safeguards.",
    winning_argument: "High-risk systems require enforceable controls.",
    confidence: "high",
};
const agentMessage = message({
    id: "agent-synthesis",
    agent_id: agents[0].id,
    agent_role: agents[0].role,
    sender_type: "agent",
    payload: agentPayload,
    text: JSON.stringify(agentPayload),
});
const verdictPayload = {
    message_type: "synthesis_verdict",
    agent_role: "moderator",
    one_sentence_takeaway: "Strict risk-tiered regulation is necessary and net-positive.",
    recommended_answer: "Adopt risk-tiered regulation with safeguards against regulatory capture.",
    consensus_statement: "All agents support controls for high-risk systems.",
    main_disagreement: "The remaining dispute is implementation scope.",
    confidence: "high",
    reasoning_basis: ["The strongest objections were addressed.", "Revised positions converged."],
    unresolved_questions: ["How should capture risk be audited?"],
    generation_status: "success",
};
const judgeMessage = message({
    id: "judge-verdict",
    payload: verdictPayload,
    text: JSON.stringify(verdictPayload),
    sequence_no: 2,
});

const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
});

try {
    const { buildDebateProcessModel, getReadableMessageText } = await vite.ssrLoadModule(
        "/src/features/debate/model/debate-process.selectors.ts",
    );
    const { replaceGenericAgentLabels } = await vite.ssrLoadModule(
        "/src/features/debate/model/debate-display.ts",
    );

    const completedModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage, judgeMessage],
        finalSummary: agentPayload,
    }));
    assert.equal(completedModel.round3.status, "completed");
    assert.equal(completedModel.round3.moderatorVerdict.recommendedAnswer, verdictPayload.recommended_answer);
    assert.equal(completedModel.round3.moderatorVerdict.oneSentenceTakeaway, verdictPayload.one_sentence_takeaway);
    assert.deepEqual(completedModel.round3.howReached, verdictPayload.reasoning_basis);
    assert.equal(completedModel.diagnostics.round3.moderatorVerdictSource.messageId, "judge-verdict");
    assert.equal(completedModel.diagnostics.round3.moderatorVerdictSource.senderType, "judge");
    assert.equal(completedModel.diagnostics.round3.fallbackExtractionUsed, false);
    assert.equal(completedModel.round3.agentSyntheses[0].finalPosition, agentPayload.final_position);
    assert.doesNotMatch(completedModel.round3.agentSyntheses[0].fullText, /^\s*\{/);
    assert.equal(getReadableMessageText(agentMessage), agentPayload.final_position);

    const missingVerdictModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage],
        finalSummary: agentPayload,
    }));
    assert.equal(missingVerdictModel.round3.status, "completed");
    assert.equal(missingVerdictModel.round3.moderatorVerdict, null);
    assert.equal(missingVerdictModel.round3.agentSyntheses.length, 1);

    const failedPlaceholder = {
        message_type: "synthesis_verdict",
        agent_role: "moderator",
        generation_status: "failed",
        recommended_answer: "",
        response: "",
        parse_warnings: ["synthesis_verdict_generation_failed"],
        error: "provider unavailable",
    };
    const failedModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage, message({ id: "failed-verdict", payload: failedPlaceholder, text: JSON.stringify(failedPlaceholder) })],
        turnStatus: "partially_completed",
        synthesisStatus: "failed",
        stage5Status: "failed",
    }));
    assert.equal(failedModel.round3.status, "failed");
    assert.equal(failedModel.round3.moderatorVerdict, null);

    const fallbackModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage],
        finalSummary: verdictPayload,
    }));
    assert.equal(fallbackModel.round3.moderatorVerdict.recommendedAnswer, verdictPayload.recommended_answer);
    assert.equal(fallbackModel.diagnostics.round3.moderatorVerdictSource.location, "turn.final_summary");
    assert.equal(fallbackModel.diagnostics.round3.fallbackExtractionUsed, true);

    const plainTextModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage, message({ id: "plain-judge", text: "Adopt regulation with strict oversight." })],
    }));
    assert.equal(plainTextModel.round3.moderatorVerdict.recommendedAnswer, "Adopt regulation with strict oversight.");

    const nestedFallbackModel = buildDebateProcessModel(sessionWith({
        stage5Messages: [agentMessage],
        finalSummary: { moderatorVerdict: verdictPayload },
    }));
    assert.equal(nestedFallbackModel.round3.moderatorVerdict.recommendedAnswer, verdictPayload.recommended_answer);

    const sessionVerdictSnapshot = sessionWith({ stage5Messages: [agentMessage] });
    sessionVerdictSnapshot.verdict = "Adopt regulation using a risk-tiered framework.";
    const sessionVerdictModel = buildDebateProcessModel(sessionVerdictSnapshot);
    assert.equal(sessionVerdictModel.round3.moderatorVerdict.recommendedAnswer, sessionVerdictSnapshot.verdict);
    assert.equal(sessionVerdictModel.diagnostics.round3.moderatorVerdictSource.location, "session.verdict");

    const displayAgents = [
        { displayName: "Policy Analyst" },
        { displayName: "Innovation Strategist" },
        { displayName: "Critical Challenger" },
    ];
    assert.equal(
        replaceGenericAgentLabels(
            "Agent 1's argument challenged agent 2, while Agent 3’s safeguard survived. Agent 20 stays unchanged.",
            displayAgents,
        ),
        "Policy Analyst's argument challenged Innovation Strategist, while Critical Challenger’s safeguard survived. Agent 20 stays unchanged.",
    );

    const round3Ui = readFileSync(
        new URL("../src/features/debate/ui/Round3SynthesisVerdict.tsx", import.meta.url),
        "utf8",
    );
    assert.match(round3Ui, /status === "failed"[\s\S]*Final synthesis failed/);
    assert.doesNotMatch(round3Ui, /status === "completed"[\s\S]{0,300}Final synthesis failed/);
    assert.match(round3Ui, /Moderator verdict was not found in the saved debate snapshot/);
    assert.match(round3Ui, /Show full moderator answer/);
    assert.match(round3Ui, /Agent synthesis details/);
    assert.match(round3Ui, /Show details/);
    assert.match(round3Ui, /Show full response/);
    assert.doesNotMatch(round3Ui, /Agent Synthesis Reports/);
    assert.doesNotMatch(round3Ui, /Winning Argument/);
    assert.doesNotMatch(round3Ui, /Losing Argument/);
    assert.doesNotMatch(round3Ui, /Optional Details/);
    assert.doesNotMatch(round3Ui, /tradeoffs\?\.length\s*\|\|/);
    assert.ok(round3Ui.indexOf("FinalVerdictCard") < round3Ui.indexOf("WhyVerdictWasReached"));
    assert.ok(round3Ui.indexOf("WhyVerdictWasReached") < round3Ui.indexOf("CollapsibleAgentSynthesisSummary"));

    console.log("Round 3 verdict extraction and state checks passed.");
} finally {
    await vite.close();
}
