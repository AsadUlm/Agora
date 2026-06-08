import type { AgentDTO } from "../api/debate.types";
import type { DebateExecutionState } from "./execution-state";
import type { DebateGraphEdge, DebateGraphNode } from "./graph.types";

export interface ActiveNarration {
    title: string;
    sublabel: string;
    relation: string | null;
    sourceRole: string | null;
    targetRole: string | null;
}

export function getGeneratingNodeId(execution: DebateExecutionState): string | null {
    if (execution.debateStatus !== "running") return null;
    if (execution.activeRound === 1 && execution.currentAgentId) {
        return `agent-${execution.currentAgentId}`;
    }
    if (execution.activeRound === 2 && execution.currentAgentId) {
        return `agent-${execution.currentAgentId}-r2`;
    }
    if (execution.activeRound === 3) {
        return "synthesis-node";
    }
    return null;
}

export function getLoadingCopy(args: {
    round: number;
    sourceRole?: string | null;
    targetRole?: string | null;
}): string {
    const source = args.sourceRole ?? "Agent";
    const target = args.targetRole;

    if (args.round === 1) {
        return "Analyzing arguments";
    }
    if (args.round === 2) {
        return target
            ? `${source} challenging ${target}`
            : "Constructing critique";
    }
    return "Synthesizing conclusions";
}

export function deriveActiveNarration(args: {
    execution: DebateExecutionState;
    agents: AgentDTO[];
    nodes: DebateGraphNode[];
    edges: DebateGraphEdge[];
}): ActiveNarration {
    const { execution, agents, nodes, edges } = args;

    if (execution.debateStatus === "completed") {
        return {
            title: "Debate Complete",
            sublabel: "Synthesis finalized and all rounds closed",
            relation: null,
            sourceRole: null,
            targetRole: null,
        };
    }

    if (execution.debateStatus === "failed") {
        return {
            title: "Debate failed",
            sublabel: execution.failureMessage ?? "Generation interrupted",
            relation: null,
            sourceRole: null,
            targetRole: null,
        };
    }

    if (execution.debateStatus === "queued") {
        return {
            title: "Preparing agent execution...",
            sublabel: "Round 1 will begin shortly",
            relation: null,
            sourceRole: null,
            targetRole: null,
        };
    }

    if (execution.activeRound === 3) {
        // If the synthesis node is already visible in the graph, the synthesis is
        // functionally complete even if turn_completed hasn't arrived yet (e.g. race
        // condition between DB commit and WS event delivery). Show "complete" narration
        // immediately so the overlay disappears as soon as the node appears.
        const synthesisNodeVisible = nodes.some(
            (n) =>
                (n.kind === "synthesis" ||
                    n.kind === "followup-synthesis" ||
                    n.id === "synthesis-node" ||
                    (n.id?.includes("synthesis") === true)) &&
                n.status !== "hidden" &&
                n.status !== "entering",
        );
        if (synthesisNodeVisible) {
            return {
                title: "Debate Complete",
                sublabel: "Synthesis finalized and all rounds closed",
                relation: null,
                sourceRole: null,
                targetRole: null,
            };
        }
        return {
            title: "Synthesizing conclusions...",
            sublabel: "Consolidating all perspectives into final answer",
            relation: null,
            sourceRole: "Synthesis",
            targetRole: null,
        };
    }

    // Follow-up synthesis rounds (round > 3, round type updated_synthesis).
    // These are functionally the same as round 3 but for follow-up cycles.
    if (execution.activeRound > 3) {
        const followupSynthesisVisible = nodes.some(
            (n) =>
                (n.kind === "followup-synthesis" ||
                    n.kind === "synthesis" ||
                    n.id?.includes("synthesis") === true) &&
                n.status !== "hidden" &&
                n.status !== "entering",
        );
        if (followupSynthesisVisible) {
            return {
                title: "Follow-up cycle complete",
                sublabel: "Updated synthesis finalized",
                relation: null,
                sourceRole: null,
                targetRole: null,
            };
        }
        return {
            title: "Updating synthesis...",
            sublabel: "Consolidating follow-up perspectives",
            relation: null,
            sourceRole: "Synthesis",
            targetRole: null,
        };
    }

    const sourceRole = execution.currentAgentRole ?? "Agent";

    if (execution.activeRound === 1) {
        return {
            title: `${sourceRole} is generating response...`,
            sublabel: "Analyzing arguments and building initial stance",
            relation: null,
            sourceRole,
            targetRole: null,
        };
    }

    const sourceNodeId = execution.currentAgentId
        ? `agent-${execution.currentAgentId}-r2`
        : null;

    const relation = inferRound2Relation(sourceNodeId, agents, nodes, edges);
    if (!relation) {
        return {
            title: `${sourceRole} is constructing critique...`,
            sublabel: "Evaluating another agent's reasoning",
            relation: null,
            sourceRole,
            targetRole: null,
        };
    }

    const verb = relation.kind === "questions"
        ? "questioning"
        : relation.kind === "supports"
            ? "responding to"
            : "challenging";

    return {
        title: `${relation.sourceRole} is ${verb} ${relation.targetRole}...`,
        sublabel: `${relation.sourceRole} responding to ${relation.targetRole}`,
        relation: `${relation.sourceRole} -> ${relation.targetRole}`,
        sourceRole: relation.sourceRole,
        targetRole: relation.targetRole,
    };
}

export function inferRound2Relation(
    sourceNodeId: string | null,
    agents: AgentDTO[],
    nodes: DebateGraphNode[],
    edges: DebateGraphEdge[],
): { sourceRole: string; targetRole: string; kind: DebateGraphEdge["kind"] } | null {
    if (!sourceNodeId) return null;

    const sourceRole = resolveRoleFromNodeId(sourceNodeId, agents, nodes);
    if (!sourceRole) return null;

    const candidate = [...edges]
        .reverse()
        .find(
            (e) =>
                e.round === 2
                && e.source === sourceNodeId
                && e.kind !== "initial"
                && e.status !== "hidden",
        );

    if (!candidate) return null;

    const targetRole = resolveRoleFromNodeId(candidate.target, agents, nodes);
    if (!targetRole) return null;

    return {
        sourceRole,
        targetRole,
        kind: candidate.kind,
    };
}

function resolveRoleFromNodeId(
    nodeId: string,
    agents: AgentDTO[],
    nodes: DebateGraphNode[],
): string | null {
    if (nodeId === "synthesis-node") return "Synthesis";
    if (nodeId === "question-node") return "Question";

    if (nodeId.startsWith("agent-")) {
        const normalized = nodeId.replace(/^agent-/, "").replace(/-r\d+$/, "");
        const byId = agents.find((a) => a.id === normalized)?.role;
        if (byId) return byId;
    }

    const byNode = nodes.find((n) => n.id === nodeId);
    return byNode?.agentRole ?? byNode?.label ?? null;
}
