import type { AgentDTO } from "../api/debate.types";
import type {
    DebateGraph,
    DebateGraphEdge,
    DebateGraphNode,
    GraphEdgeStatus,
    GraphNodeStatus,
} from "./graph.types";

function orderedAgents(agents: AgentDTO[]): AgentDTO[] {
    return [...agents].sort((a, b) => {
        const order = (a.position_order ?? 0) - (b.position_order ?? 0);
        return order || a.id.localeCompare(b.id);
    });
}

function visibleStatus(...nodes: Array<DebateGraphNode | undefined>): GraphEdgeStatus {
    const statuses = nodes.map((node) => node?.status);
    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("active")) return "active";
    if (statuses.includes("entering")) return "drawing";
    if (statuses.every((status) => status === "hidden")) return "hidden";
    if (statuses.includes("completed")) return "completed";
    return "visible";
}

function round2Summary(
    initialNode: DebateGraphNode | undefined,
    exchangeNode: DebateGraphNode,
): string | undefined {
    const revised =
        initialNode?.metadata?.["changeSummary"]
        ?? initialNode?.metadata?.["revisedPosition"]
        ?? exchangeNode.metadata?.["changeSummary"]
        ?? exchangeNode.metadata?.["revisedPosition"];

    return typeof revised === "string" && revised.trim()
        ? revised
        : exchangeNode.summary || exchangeNode.content;
}

function normalizeNode(
    node: DebateGraphNode,
    kind: DebateGraphNode["kind"],
    round: number,
    summary?: string,
): DebateGraphNode {
    return {
        ...node,
        kind,
        round,
        summary: summary || node.summary,
        content: undefined,
        metadata: {
            loading: node.metadata?.["loading"],
            loadingLabel: node.metadata?.["loadingLabel"],
            safeError: node.metadata?.["safeError"],
        },
    };
}

export interface DebateVisualGraph extends DebateGraph {
    agentOrder: string[];
}

/**
 * Builds the compact user-facing graph. The canonical graph remains responsible
 * for persistence/live events; this selector intentionally exposes only the
 * question, one initial node per agent, one exchange node per agent, and one
 * unified synthesis node.
 */
export function buildDebateVisualGraph(
    graph: DebateGraph,
    agents: AgentDTO[],
    cycle = 1,
): DebateVisualGraph {
    const cycleNodes = graph.nodes.filter((node) => (node.cycle ?? 1) === cycle);
    const sortedAgents = orderedAgents(agents);
    const nodes: DebateGraphNode[] = [];
    const edges: DebateGraphEdge[] = [];

    const question = cycleNodes.find((node) =>
        node.kind === "question" || node.kind === "followup-question",
    );
    if (question) {
        nodes.push(normalizeNode(question, "question", 0));
    }

    const initialByAgent = new Map<string, DebateGraphNode>();
    const exchangeByAgent = new Map<string, DebateGraphNode>();

    for (const agent of sortedAgents) {
        const initial = cycleNodes.find((node) =>
            node.agentId === agent.id
            && (node.kind === "agent" || node.kind === "followup-agent"),
        );
        if (initial) {
            const normalized = normalizeNode(initial, "agent", 1);
            initialByAgent.set(agent.id, normalized);
            nodes.push(normalized);
        }

        const exchange = cycleNodes.find((node) =>
            node.agentId === agent.id
            && (node.kind === "intermediate" || node.kind === "followup-intermediate"),
        );
        if (exchange) {
            // Compute circular debate relationships for R2 node display
            const agentIndex = sortedAgents.indexOf(agent);
            const n = sortedAgents.length;
            const challengesAgent = n >= 2 ? sortedAgents[(agentIndex + 1) % n] : undefined;
            const respondsToAgent = n >= 2 ? sortedAgents[(agentIndex - 1 + n) % n] : undefined;

            const normalized = normalizeNode(
                exchange,
                "intermediate",
                2,
                round2Summary(initial, exchange),
            );
            // Attach relationship metadata so AgentNode can display them
            normalized.metadata = {
                ...normalized.metadata,
                challengesAgentRole: challengesAgent?.role,
                challengesAgentId: challengesAgent?.id,
                respondsToAgentRole: respondsToAgent?.role,
                respondsToAgentId: respondsToAgent?.id,
            };
            exchangeByAgent.set(agent.id, normalized);
            nodes.push(normalized);
        }
    }

    const synthesis = cycleNodes.find((node) =>
        node.kind === "synthesis" || node.kind === "followup-synthesis",
    );
    if (synthesis) {
        nodes.push(normalizeNode(synthesis, "synthesis", 3));
    }

    if (question) {
        for (const initial of initialByAgent.values()) {
            edges.push({
                id: `visual-${cycle}-question-${initial.agentId}`,
                source: question.id,
                target: initial.id,
                kind: "initial",
                round: 1,
                status: visibleStatus(question, initial),
            });
        }
    }

    if (sortedAgents.length >= 2) {
        sortedAgents.forEach((agent, index) => {
            const target = sortedAgents[(index + 1) % sortedAgents.length];
            const sourceNode = exchangeByAgent.get(agent.id);
            const targetNode = exchangeByAgent.get(target.id);
            if (!sourceNode || !targetNode) return;
            edges.push({
                id: `visual-${cycle}-challenge-${agent.id}-${target.id}`,
                source: sourceNode.id,
                target: targetNode.id,
                kind: "challenges",
                round: 2,
                status: visibleStatus(sourceNode, targetNode),
                label: "challenges",
                sourceAgentId: agent.id,
                targetAgentId: target.id,
            });
        });
    }

    if (synthesis) {
        for (const agent of sortedAgents) {
            const source = exchangeByAgent.get(agent.id) ?? initialByAgent.get(agent.id);
            if (!source) continue;
            edges.push({
                id: `visual-${cycle}-synthesis-${agent.id}`,
                source: source.id,
                target: synthesis.id,
                kind: "summarizes",
                round: 3,
                status: visibleStatus(source, synthesis),
            });
        }
    }

    return {
        nodes,
        edges,
        agentOrder: sortedAgents.map((agent) => agent.role),
    };
}

export function graphNodeStatus(
    node: DebateGraphNode | undefined,
    fallback: GraphNodeStatus = "visible",
): GraphNodeStatus {
    return node?.status ?? fallback;
}
