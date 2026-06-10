import assert from "node:assert/strict";
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
    {
        id: "agent-innovation",
        role: "Innovation Strategist",
        provider: "test",
        model: "test",
        temperature: null,
        reasoning_style: null,
        position_order: 1,
        knowledge_mode: null,
        knowledge_strict: null,
    },
    {
        id: "agent-critical",
        role: "Critical Challenger",
        provider: "test",
        model: "test",
        temperature: null,
        reasoning_style: null,
        position_order: 2,
        knowledge_mode: null,
        knowledge_strict: null,
    },
];

function message(stage, agent, payload) {
    return {
        id: `${stage}-${agent.id}`,
        agent_id: agent.id,
        agent_role: agent.role,
        message_type: "agent_response",
        sender_type: "agent",
        payload,
        text: String(payload.response ?? payload.short_summary ?? payload.revised_position ?? ""),
        sequence_no: 1,
        created_at: "2026-06-09T00:00:00Z",
    };
}

function round(roundNumber, roundType, messages) {
    return {
        id: `round-${roundNumber}`,
        round_number: roundNumber,
        cycle_number: 1,
        round_type: roundType,
        status: "completed",
        started_at: null,
        ended_at: null,
        messages,
    };
}

const stage2 = [
    message(2, agents[0], { target_agent: "Innovation Strategist", short_summary: "Policy critique of innovation." }),
    message(2, agents[1], { target_agent: "Policy Analyst", short_summary: "Innovation critique intended for critical." }),
    message(2, agents[2], { target_agent: "General Position", short_summary: "Critical critique intended for policy." }),
];
const stage3 = [
    message(3, agents[0], { response: "Policy response." }),
    message(3, agents[1], { response: "Innovation response." }),
    message(3, agents[2], { response: "Critical response." }),
];
const stage4 = [
    message(4, agents[0], { revised_position: "Policy revised.", changed: true, change_type: "changed_stance" }),
    message(4, agents[1], { revised_position: "Innovation revised.", changed: true, change_type: "narrowed_position" }),
    message(4, agents[2], { revised_position: "Critical held.", changed: false }),
];

const session = {
    id: "session",
    title: "Mapping test",
    question: "Does circular mapping work?",
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
        final_summary: null,
        rounds: [
            round(1, "initial", agents.map((agent) => message(1, agent, { short_summary: `${agent.role} initial.` }))),
            round(2, "critique", stage2),
            round(3, "critique_response", stage3),
            round(4, "revised_position", stage4),
            round(5, "final", []),
        ],
        debate_trace: {
            critiques: [
                {
                    id: stage2[0].id,
                    from_agent_id: agents[0].id,
                    from_agent_name: agents[0].role,
                    to_agent_id: agents[1].id,
                    to_agent_name: agents[1].role,
                    target_claim: "",
                    critique_summary: "Policy critique of innovation.",
                    weakness_found: "",
                },
                {
                    id: stage2[1].id,
                    from_agent_id: agents[1].id,
                    from_agent_name: agents[1].role,
                    to_agent_id: agents[0].id,
                    to_agent_name: agents[0].role,
                    target_claim: "",
                    critique_summary: "Innovation critique intended for critical.",
                    weakness_found: "",
                },
                {
                    id: stage2[2].id,
                    from_agent_id: agents[2].id,
                    from_agent_name: agents[2].role,
                    to_agent_id: "General Position",
                    to_agent_name: "General Position",
                    target_claim: "",
                    critique_summary: "Critical critique intended for policy.",
                    weakness_found: "",
                },
            ],
            critique_responses: [],
            revised_positions: [],
            debate_impact: null,
        },
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
    const { buildDebateProcessModel } = await vite.ssrLoadModule(
        "/src/features/debate/model/debate-process.selectors.ts",
    );
    const model = buildDebateProcessModel(session);

    assert.equal(model.diagnostics.relationshipMappingMode, "circular_order");
    assert.deepEqual(model.diagnostics.agentOrder, [
        "Policy Analyst",
        "Innovation Strategist",
        "Critical Challenger",
    ]);
    assert.deepEqual(model.diagnostics.actualStage2, [
        "Policy Analyst -> Innovation Strategist",
        "Innovation Strategist -> Critical Challenger",
        "Critical Challenger -> Policy Analyst",
    ]);
    assert.deepEqual(model.diagnostics.actualStage3, [
        "Innovation Strategist -> Policy Analyst",
        "Critical Challenger -> Innovation Strategist",
        "Policy Analyst -> Critical Challenger",
    ]);
    assert.deepEqual(model.diagnostics.actualStage4, [
        "Policy Analyst <- Critical Challenger",
        "Innovation Strategist <- Policy Analyst",
        "Critical Challenger <- Innovation Strategist",
    ]);
    assert.equal(model.round2.crossCritiques[2].targetAgentName, "Policy Analyst");
    assert.equal(model.round2.responsesToCritiques[0].challengeReceived, "Policy critique of innovation.");
    assert.equal(model.round2.revisedPositions[0].critiqueReceived, "Critical critique intended for policy.");

    const shuffledSession = structuredClone(session);
    shuffledSession.agents = [agents[2], agents[0], agents[1]];
    const shuffledModel = buildDebateProcessModel(shuffledSession);
    assert.deepEqual(shuffledModel.diagnostics.agentOrder, [
        "Policy Analyst",
        "Innovation Strategist",
        "Critical Challenger",
    ]);
    assert.deepEqual(shuffledModel.diagnostics.actualStage2, model.diagnostics.actualStage2);

    const explicitSession = structuredClone(session);
    explicitSession.latest_turn.rounds[1].messages[0].payload.target_agent_id = agents[2].id;
    const explicitModel = buildDebateProcessModel(explicitSession);
    assert.equal(explicitModel.round2.crossCritiques[0].targetAgentName, "Critical Challenger");
    assert.equal(explicitModel.round2.crossCritiques[0].mappingSource, "explicit_ids");
    const explicitResponse = explicitModel.round2.responsesToCritiques.find(
        (item) => item.respondingAgentName === "Critical Challenger",
    );
    assert.equal(explicitResponse.respondingToAgentName, "Policy Analyst");
    assert.equal(explicitResponse.mappingSource, "explicit_ids");
    const explicitRevision = explicitModel.round2.revisedPositions.find(
        (item) => item.agentName === "Critical Challenger",
    );
    assert.equal(explicitRevision.revisedAfterCritiqueFromAgentName, "Policy Analyst");
    assert.equal(explicitRevision.mappingSource, "explicit_ids");

    const inconsistentExplicitSession = structuredClone(session);
    inconsistentExplicitSession.latest_turn.rounds[1].messages[0].payload.target_agent_id = agents[0].id;
    const inconsistentExplicitModel = buildDebateProcessModel(inconsistentExplicitSession);
    assert.equal(inconsistentExplicitModel.round2.crossCritiques[0].targetAgentName, "Innovation Strategist");
    assert.equal(inconsistentExplicitModel.round2.crossCritiques[0].mappingSource, "circular_order");

    console.log("Debate process relationship mapping checks passed.");
} finally {
    await vite.close();
}
