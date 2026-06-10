import assert from "node:assert/strict";
import { createServer } from "vite";

const agents = ["Policy Analyst", "Innovation Strategist"].map((role, index) => ({
    id: `agent-${index + 1}`,
    role,
    provider: "test",
    model: "test",
    temperature: null,
    reasoning_style: null,
    position_order: index,
    knowledge_mode: null,
    knowledge_strict: null,
}));

const message = (id, agent, text, payload = {}) => ({
    id,
    agent_id: agent?.id ?? null,
    agent_role: agent?.role ?? "Moderator",
    message_type: agent ? "agent_response" : "moderator_verdict",
    sender_type: agent ? "agent" : "judge",
    payload,
    text,
    sequence_no: 1,
    created_at: "2026-06-09T00:00:00Z",
});

const round = (id, cycle, type, messages, status = "completed") => ({
    id,
    round_number: cycle === 1 ? Number(id.at(-1)) : 5 + ["followup_response", "followup_critique", "updated_synthesis"].indexOf(type) + 1,
    cycle_number: cycle,
    round_type: type,
    status,
    started_at: null,
    ended_at: null,
    messages,
});

const session = {
    id: "session",
    title: "Cycle sync",
    question: "Original question?",
    status: "completed",
    created_at: "2026-06-09T00:00:00Z",
    updated_at: "2026-06-09T00:00:00Z",
    agents,
    latest_turn: {
        id: "turn",
        turn_index: 1,
        status: "completed",
        started_at: null,
        ended_at: null,
        user_message: null,
        final_summary: { recommended_answer: "Original verdict" },
        follow_ups: [{ id: "fu-1", chat_turn_id: "turn", cycle_number: 2, question: "Follow-up question?", created_at: "2026-06-09T00:00:00Z" }],
        rounds: [
            round("base-1", 1, "initial", agents.map((agent) => message(`base-${agent.id}`, agent, "Original answer", { short_summary: "Original answer" }))),
            round("base-2", 1, "critique", []),
            round("base-3", 1, "critique_response", []),
            round("base-4", 1, "revised_position", []),
            round("base-5", 1, "final", [message("base-verdict", null, "Original verdict", { recommended_answer: "Original verdict" })]),
            round("fu-response", 2, "followup_response", agents.map((agent) => message(`fu-${agent.id}`, agent, "Follow-up answer", { response: "Follow-up answer" }))),
            round("fu-critique", 2, "followup_critique", [message("fu-critique-1", agents[0], "Follow-up critique", { critique_summary: "Follow-up critique", target_agent_id: agents[1].id })]),
            round("fu-synthesis", 2, "updated_synthesis", [message("fu-verdict", null, "Updated verdict", { recommended_answer: "Updated verdict", message_type: "synthesis_verdict" })]),
        ],
        debate_trace: null,
    },
};

const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
});

try {
    const { deriveSelectedCycleState, getSelectedCycle } = await vite.ssrLoadModule("/src/features/debate/model/debate-cycle.selectors.ts");
    const { buildDebateProcessModel } = await vite.ssrLoadModule("/src/features/debate/model/debate-process.selectors.ts");

    const original = getSelectedCycle(session, 1);
    const followup = getSelectedCycle(session, 2);
    assert.equal(original.question, "Original question?");
    assert.equal(followup.question, "Follow-up question?");
    assert.equal(followup.rounds.every((item) => item.cycle_number === 2), true);
    assert.equal(followup.stages.initialAnswers.length, 2);
    assert.equal(followup.stages.crossCritiques.length, 1);
    assert.equal(followup.stages.moderatorVerdict.id, "fu-verdict");
    assert.equal(deriveSelectedCycleState(session, 2).status, "completed");

    const originalProcess = buildDebateProcessModel(session, 1);
    const followupProcess = buildDebateProcessModel(session, 2);
    assert.equal(originalProcess.cycleType, "original");
    assert.equal(followupProcess.cycleType, "followup");
    assert.equal(followupProcess.question, "Follow-up question?");
    assert.equal(followupProcess.round1.initialAnswers.every((item) => item.fullText === "Follow-up answer"), true);
    assert.equal(followupProcess.round3.moderatorVerdict.recommendedAnswer, "Updated verdict");
    assert.equal(JSON.stringify(followupProcess).includes("Original answer"), false);
    assert.equal(JSON.stringify(followupProcess).includes("Original verdict"), false);

    const missing = getSelectedCycle(session, 3);
    const missingProcess = buildDebateProcessModel(session, 3);
    assert.equal(missing.cycleType, "followup");
    assert.equal(missing.rounds.length, 0);
    assert.equal(missingProcess.round1.initialAnswers.length, 0);
    assert.equal(JSON.stringify(missingProcess).includes("Original answer"), false);

    const running = structuredClone(session);
    running.latest_turn.status = "running";
    running.latest_turn.rounds = running.latest_turn.rounds.filter((item) => item.round_type !== "updated_synthesis");
    running.latest_turn.rounds.find((item) => item.round_type === "followup_critique").status = "running";
    assert.equal(deriveSelectedCycleState(running, 1).status, "completed");
    assert.equal(deriveSelectedCycleState(running, 2).status, "running");

    const partial = structuredClone(running);
    partial.latest_turn.rounds.find((item) => item.round_type === "followup_critique").status = "completed";
    partial.latest_turn.rounds.find((item) => item.round_type === "followup_critique").messages = [];
    const partialState = deriveSelectedCycleState(partial, 2);
    assert.equal(partialState.status, "partially_completed");
    assert.equal(partialState.hasUpdatedSynthesis, false);
    assert.equal(partialState.isStuckSuspected, true);

    const failed = structuredClone(partial);
    failed.latest_turn.status = "failed";
    failed.latest_turn.rounds.find((item) => item.round_type === "followup_response").messages = [];
    failed.latest_turn.rounds.find((item) => item.round_type === "followup_response").status = "failed";
    assert.equal(deriveSelectedCycleState(failed, 2).status, "failed");

    console.log("Debate cycle sync checks passed.");
} finally {
    await vite.close();
}
