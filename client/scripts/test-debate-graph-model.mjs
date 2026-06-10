import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const agents = ["Policy Analyst", "Innovation Strategist", "Critical Challenger"].map((role, index) => ({
    id: `agent-${index + 1}`,
    role,
    provider: "test",
    model: "test",
    position_order: index,
}));

const nodes = [
    { id: "question-node", kind: "question", label: "Should AI be regulated?", round: 0, status: "completed" },
    ...agents.map((agent) => ({
        id: `agent-${agent.id}`,
        kind: "agent",
        label: agent.role,
        agentId: agent.id,
        agentRole: agent.role,
        round: 1,
        status: "completed",
        summary: `${agent.role} initial answer`,
        content: "Long raw answer that should not be carried into the visual model.",
    })),
    ...agents.map((agent) => ({
        id: `agent-${agent.id}-r2`,
        kind: "intermediate",
        label: agent.role,
        agentId: agent.id,
        agentRole: agent.role,
        round: 2,
        status: "completed",
        summary: `${agent.role} exchange`,
        content: "Long critique payload.",
    })),
    {
        id: "synthesis-node",
        kind: "synthesis",
        label: "Final Synthesis",
        round: 3,
        status: "completed",
        summary: "Use strict risk-tiered regulation.",
        content: "Long moderator answer.",
    },
    {
        id: "agent-synthesis-extra",
        kind: "agent",
        label: "Separate agent synthesis",
        round: 5,
        status: "completed",
    },
];

const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
});

try {
    const { buildDebateVisualGraph } = await vite.ssrLoadModule(
        "/src/features/debate/model/debate-graph.selectors.ts",
    );
    const graph = buildDebateVisualGraph({ nodes, edges: [] }, agents);

    assert.equal(graph.nodes.filter((node) => node.kind === "question").length, 1);
    assert.equal(graph.nodes.filter((node) => node.kind === "agent").length, 3);
    assert.equal(graph.nodes.filter((node) => node.kind === "intermediate").length, 3);
    assert.equal(graph.nodes.filter((node) => node.kind === "synthesis").length, 1);
    assert.equal(graph.nodes.some((node) => node.id === "agent-synthesis-extra"), false);
    assert.equal(graph.nodes.some((node) => node.content), false);

    assert.deepEqual(
        graph.edges.filter((edge) => edge.kind === "challenges").map((edge) => `${edge.source}->${edge.target}`),
        [
            "agent-agent-1-r2->agent-agent-2-r2",
            "agent-agent-2-r2->agent-agent-3-r2",
            "agent-agent-3-r2->agent-agent-1-r2",
        ],
    );
    assert.equal(graph.edges.filter((edge) => edge.kind === "initial").length, 3);
    assert.equal(graph.edges.filter((edge) => edge.kind === "summarizes").length, 3);

    const layout = await readFile(new URL("../src/features/debate/ui/DebateLayout.tsx", import.meta.url), "utf8");
    assert.equal(layout.includes("NodeDetailDrawer"), false);

    console.log("Debate visual graph checks passed.");
} finally {
    await vite.close();
}
