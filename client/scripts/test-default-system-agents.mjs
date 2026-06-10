import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const definitions = [
    ["policy_analyst", "Policy Analyst", "policy-oriented", "deep", "policy/model", 0.9],
    ["innovation_strategist", "Innovation Strategist", "strategic", "normal", "innovation/model", 0.8],
    ["critical_challenger", "Critical Challenger", "critical", "deep", "critical/model", 0.4],
];

const presets = definitions.map(([systemKey, name, style, depth, model, temperature], index) => ({
    id: `preset-${index}`,
    is_system: true,
    system_key: systemKey,
    name,
    description: `${name} description`,
    type: "system",
    visibility: "system",
    role_description: `${name} persona`,
    reasoning_style: style,
    reasoning_depth: depth,
    provider: "openrouter",
    model,
    model_preset: null,
    temperature,
    rag_mode: "no_docs",
    document_ids: [],
    strict_grounding: false,
    is_default: true,
}));

const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("../src", import.meta.url)),
        },
    },
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
});

try {
    const { createDefaultAgentsFromSystemPresets } = await vite.ssrLoadModule(
        "/src/features/agent-presets/model/agent-preset.types.ts",
    );
    const agents = createDefaultAgentsFromSystemPresets(presets);

    assert.deepEqual(
        agents.map((agent) => agent.role),
        ["Critical Challenger", "Innovation Strategist", "Policy Analyst"],
    );
    assert.deepEqual(
        agents.map((agent) => agent._id),
        [
            "agent-critical-challenger",
            "agent-innovation-strategist",
            "agent-policy-analyst",
        ],
    );
    assert.ok(agents.every((agent) => agent.enabled));
    assert.ok(agents.every((agent) => agent.preset?.startsWith("preset-")));
    assert.ok(agents.every((agent) => agent.roleDescription.endsWith("persona")));
    assert.ok(agents.every((agent) => !["analyst", "critic", "creative"].includes(agent.role)));
    assert.throws(
        () => createDefaultAgentsFromSystemPresets(presets.slice(0, 2)),
        /critical_challenger/,
    );

    console.log("Default system agent initialization checks passed.");
} finally {
    await vite.close();
}
