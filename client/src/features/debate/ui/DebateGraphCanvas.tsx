import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
} from "@xyflow/react";
import type { Node, Edge, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "motion/react";

import { useGraphStore } from "../model/graph.store";
import { usePlaybackStore } from "../model/playback.store";
import { useDebateStore } from "../model/debate.store";
import type { DebateGraphNode, DebateGraphEdge, GraphEdgeKind } from "../model/graph.types";
import { useDebateExecutionState } from "../model/useDebateExecutionState";
import { deriveActiveNarration, getGeneratingNodeId, getLoadingCopy, inferRound2Relation } from "../model/execution-ux";

import QuestionNode from "./nodes/QuestionNode";
import AgentNode from "./nodes/AgentNode";
import SynthesisNode from "./nodes/SynthesisNode";
import CritiqueEdge from "./edges/CritiqueEdge";
import SupportEdge from "./edges/SupportEdge";
import InquiryEdge from "./edges/InquiryEdge";

// ── Cycle band label (decorative, non-interactive) ─────────────────────

function CycleBandLabel({ data }: { data: { label: string; subLabel?: string } }) {
    return (
        <div
            className="pointer-events-none select-none"
            style={{
                whiteSpace: "nowrap",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
        >
            <div
                style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#a78bfa",
                    background: "rgba(167, 139, 250, 0.10)",
                    border: "1px solid rgba(167, 139, 250, 0.35)",
                    padding: "4px 10px",
                    borderRadius: 6,
                }}
            >
                {data.label}
            </div>
            {data.subLabel ? (
                <div
                    style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: "rgba(167, 139, 250, 0.7)",
                    }}
                >
                    {data.subLabel}
                </div>
            ) : null}
        </div>
    );
}

// ── Node type registry ────────────────────────────────────────────────

const nodeTypes = {
    question: QuestionNode,
    agent: AgentNode,
    synthesis: SynthesisNode,
    intermediate: AgentNode,
    "followup-question": QuestionNode,
    "followup-agent": AgentNode,
    "followup-intermediate": AgentNode,
    "followup-synthesis": SynthesisNode,
    "cycle-label": CycleBandLabel,
};

const edgeTypes = {
    challenges: CritiqueEdge,
    supports: SupportEdge,
    questions: InquiryEdge,
    initial: SupportEdge,
    summarizes: InquiryEdge,
};

// ── Deterministic layout ──────────────────────────────────────────────

const LEVEL_Y = {
    question: 40,
    agents: 250,
    interactions: 500,
    synthesis: 720,
};
const CANVAS_CENTER_X = 500;
const AGENT_HORIZONTAL_GAP = 280;
const NODE_WIDTH_ESTIMATE = 200;

function computeLayout(graphNodes: DebateGraphNode[]): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const agents = graphNodes.filter((n) => n.kind === "agent");
    const intermediates = graphNodes.filter((n) => n.kind === "intermediate");
    const hasQuestion = graphNodes.some((n) => n.kind === "question");
    const hasSynthesis = graphNodes.some((n) => n.kind === "synthesis");

    // Dynamic spacing based on agent count
    const agentCount = agents.length;
    const gap = Math.max(AGENT_HORIZONTAL_GAP, 800 / (agentCount + 1));

    // Question node: top center
    if (hasQuestion) {
        positions.set("question-node", { x: CANVAS_CENTER_X - 100, y: LEVEL_Y.question });
    }

    // Agent nodes: evenly spaced horizontal line (Round 1 level)
    if (agentCount > 0) {
        const totalWidth = (agentCount - 1) * gap;
        const startX = CANVAS_CENTER_X - totalWidth / 2 - NODE_WIDTH_ESTIMATE / 2;
        agents.forEach((agent, index) => {
            const x = startX + index * gap;
            positions.set(agent.id, { x, y: LEVEL_Y.agents });
        });
    }

    // Intermediate nodes: positioned below their parent agent (Round 2 level)
    intermediates.forEach((node) => {
        // Extract parent agent ID: "agent-{id}-r2" → "agent-{id}"
        const parentId = node.id.replace(/-r\d+$/, "");
        const parentPos = positions.get(parentId);
        if (parentPos) {
            positions.set(node.id, { x: parentPos.x, y: LEVEL_Y.interactions });
        } else {
            // Fallback: spread like agents
            const intIdx = intermediates.indexOf(node);
            const totalWidth = (intermediates.length - 1) * gap;
            const startX = CANVAS_CENTER_X - totalWidth / 2 - NODE_WIDTH_ESTIMATE / 2;
            positions.set(node.id, { x: startX + intIdx * gap, y: LEVEL_Y.interactions });
        }
    });

    // Synthesis node: bottom center
    if (hasSynthesis) {
        positions.set("synthesis-node", { x: CANVAS_CENTER_X - 110, y: LEVEL_Y.synthesis });
    }

    // Follow-up cycles (cycle ≥ 2): stack below the initial synthesis,
    // one band per cycle (question → responses → critiques → updated synthesis).
    const cycleNumbers = Array.from(
        new Set(
            graphNodes
                .map((n) => n.cycle ?? 0)
                .filter((c) => c >= 2),
        ),
    ).sort((a, b) => a - b);

    const FOLLOWUP_BAND_HEIGHT = 720; // question + responses + critiques + synthesis
    const FOLLOWUP_QUESTION_OFFSET = 140;
    const FOLLOWUP_RESPONSE_OFFSET = 320;
    const FOLLOWUP_CRITIQUE_OFFSET = 500;
    const FOLLOWUP_SYNTHESIS_OFFSET = 680;

    for (const cycle of cycleNumbers) {
        const bandTop = LEVEL_Y.synthesis + 120 + (cycle - 2) * FOLLOWUP_BAND_HEIGHT;

        // Follow-up question — center
        const fuq = graphNodes.find(
            (n) => n.kind === "followup-question" && n.cycle === cycle,
        );
        if (fuq) {
            positions.set(fuq.id, { x: CANVAS_CENTER_X - 110, y: bandTop + FOLLOWUP_QUESTION_OFFSET });
        }

        const responses = graphNodes.filter(
            (n) => n.kind === "followup-agent" && n.cycle === cycle,
        );
        const critiques = graphNodes.filter(
            (n) => n.kind === "followup-intermediate" && n.cycle === cycle,
        );

        const responseCount = Math.max(responses.length, agentCount);
        const respGap = Math.max(AGENT_HORIZONTAL_GAP, 800 / (responseCount + 1));
        const respWidth = (responseCount - 1) * respGap;
        const respStart = CANVAS_CENTER_X - respWidth / 2 - NODE_WIDTH_ESTIMATE / 2;

        responses.forEach((node, idx) => {
            // Try to align with the original agent's x; fall back to row order.
            const parentAgentId = node.agentId ? `agent-${node.agentId}` : null;
            const parentPos = parentAgentId ? positions.get(parentAgentId) : undefined;
            const x = parentPos ? parentPos.x : respStart + idx * respGap;
            positions.set(node.id, { x, y: bandTop + FOLLOWUP_RESPONSE_OFFSET });
        });

        critiques.forEach((node, idx) => {
            const parentAgentId = node.agentId ? `agent-${node.agentId}` : null;
            const parentPos = parentAgentId ? positions.get(parentAgentId) : undefined;
            const x = parentPos ? parentPos.x : respStart + idx * respGap;
            positions.set(node.id, { x, y: bandTop + FOLLOWUP_CRITIQUE_OFFSET });
        });

        const fus = graphNodes.find(
            (n) => n.kind === "followup-synthesis" && n.cycle === cycle,
        );
        if (fus) {
            positions.set(fus.id, { x: CANVAS_CENTER_X - 110, y: bandTop + FOLLOWUP_SYNTHESIS_OFFSET });
        }
    }

    return positions;
}

function toFlowEdgeType(kind: GraphEdgeKind): string {
    return kind;
}

function edgeColor(kind: GraphEdgeKind): string {
    switch (kind) {
        case "challenges": return "#f472b6";
        case "supports": return "#34d399";
        case "questions": return "#818cf8";
        case "summarizes": return "#a78bfa";
        case "initial":
        default: return "#6366f1";
    }
}

/** Check if a node should be highlighted given the selected round */
function isNodeRelevant(n: DebateGraphNode, selectedRound: number | null): boolean {
    if (selectedRound === null) return true;
    if (n.kind === "question") return true; // question always relevant
    if (n.kind === "synthesis") return selectedRound === 3;
    if (n.kind === "intermediate") return selectedRound === 2;
    // Follow-up nodes are always relevant when no round filter narrowed below 3.
    if (
        n.kind === "followup-question"
        || n.kind === "followup-agent"
        || n.kind === "followup-intermediate"
        || n.kind === "followup-synthesis"
    ) {
        return true;
    }
    // Agent nodes are relevant to rounds 1 and 2 (they appear in round 1)
    return selectedRound === 1 || selectedRound === 2;
}

/** Check if an edge should be highlighted given the selected round */
function isEdgeRelevant(e: DebateGraphEdge, selectedRound: number | null): boolean {
    if (selectedRound === null) return true;
    return e.round === selectedRound;
}

function nodeRevealRank(args: {
    node: DebateGraphNode;
    agentOrder: Map<string, number>;
    interactionOrder: Map<string, number>;
}): number {
    const { node, agentOrder, interactionOrder } = args;

    if (node.kind === "question") return 0;
    if (node.kind === "agent") {
        const idx = node.agentId ? (agentOrder.get(node.agentId) ?? 999) : 999;
        return 1000 + idx;
    }
    if (node.kind === "intermediate") {
        const idx = interactionOrder.get(node.id) ?? (node.agentId ? agentOrder.get(node.agentId) ?? 999 : 999);
        return 2000 + idx;
    }
    return 3000;
}

function edgeRevealRank(edge: DebateGraphEdge, indexById: Map<string, number>): number {
    const base = edge.round * 1000;
    const idx = indexById.get(edge.id) ?? 999;
    return base + idx;
}

// ── Component ─────────────────────────────────────────────────────────

export default function DebateGraphCanvas() {
    const graph = useGraphStore((s) => s.graph);
    const agents = useDebateStore((s) => s.agents);
    const selectNode = useGraphStore((s) => s.selectNode);
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const clearFocus = useGraphStore((s) => s.clearFocus);
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const execution = useDebateExecutionState();
    const playbackMode = useDebateStore((s) => s.playbackMode);
    const openedAsCompleted = useDebateStore((s) => s.openedAsCompleted);
    const playbackQueue = useDebateStore((s) => s.playbackQueue);
    const revealedNodeIds = useDebateStore((s) => s.revealedNodeIds);
    const revealedEdgeIds = useDebateStore((s) => s.revealedEdgeIds);
    const syncPlaybackFromCanonical = useDebateStore((s) => s.syncPlaybackFromCanonical);
    const revealNextVisual = useDebateStore((s) => s.revealNextVisual);
    const setRenderedCounts = useDebateStore((s) => s.setRenderedCounts);
    const prevVisibleCountRef = useRef(0);
    const rfInstance = useRef<ReactFlowInstance | null>(null);
    const [freshEdgeIds, setFreshEdgeIds] = useState<string[]>([]);
    const [showCompletionBanner, setShowCompletionBanner] = useState(false);
    const [completionPulse, setCompletionPulse] = useState(false);
    const autoRunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const freshEdgeTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const prevRevealedEdgeSetRef = useRef<Set<string>>(new Set());
    const prevDebateStatusRef = useRef(execution.debateStatus);
    const isLiveExecution = execution.debateStatus === "queued" || execution.debateStatus === "running";

    const markEdgeFresh = useCallback((edgeId: string) => {
        setFreshEdgeIds((prev) => (prev.includes(edgeId) ? prev : [...prev, edgeId]));
        const existing = freshEdgeTimeoutsRef.current[edgeId];
        if (existing) clearTimeout(existing);
        freshEdgeTimeoutsRef.current[edgeId] = setTimeout(() => {
            setFreshEdgeIds((prev) => prev.filter((id) => id !== edgeId));
            delete freshEdgeTimeoutsRef.current[edgeId];
        }, 1200);
    }, []);

    useEffect(() => {
        return () => {
            if (autoRunTimerRef.current) clearTimeout(autoRunTimerRef.current);
            Object.values(freshEdgeTimeoutsRef.current).forEach((t) => clearTimeout(t));
        };
    }, []);

    useEffect(() => {
        const wasCompleted = prevDebateStatusRef.current === "completed";
        if (!wasCompleted && execution.debateStatus === "completed") {
            setShowCompletionBanner(true);
            setCompletionPulse(true);
            const hideTimer = setTimeout(() => setShowCompletionBanner(false), 2400);
            const pulseTimer = setTimeout(() => setCompletionPulse(false), 1800);
            prevDebateStatusRef.current = execution.debateStatus;
            return () => {
                clearTimeout(hideTimer);
                clearTimeout(pulseTimer);
            };
        }

        if (execution.debateStatus !== "completed") {
            setShowCompletionBanner(false);
            setCompletionPulse(false);
        }
        prevDebateStatusRef.current = execution.debateStatus;
    }, [execution.debateStatus]);

    const renderNodes = useMemo(() => {
        const nodes = [...graph.nodes];
        const isLive = isLiveExecution;

        const relation = execution.activeRound === 2
            ? inferRound2Relation(
                execution.currentAgentId ? `agent-${execution.currentAgentId}-r2` : null,
                agents,
                nodes,
                graph.edges,
            )
            : null;

        if (!isLive) return nodes;

        const roleById = (id: string | null): string =>
            agents.find((a) => a.id === id)?.role ?? "Agent";

        if (execution.activeRound === 1 && execution.currentAgentId) {
            const nodeId = `agent-${execution.currentAgentId}`;
            const idx = nodes.findIndex((n) => n.id === nodeId);
            if (idx >= 0) {
                const n = nodes[idx];
                if (n.status === "hidden" || !n.content) {
                    nodes[idx] = {
                        ...n,
                        round: 1,
                        status: "active",
                        summary: n.summary || "Generating response...",
                        metadata: {
                            ...(n.metadata ?? {}),
                            loading: true,
                            loadingLabel: getLoadingCopy({
                                round: 1,
                                sourceRole: roleById(execution.currentAgentId),
                            }),
                        },
                    };
                }
            } else {
                nodes.push({
                    id: nodeId,
                    kind: "agent",
                    label: roleById(execution.currentAgentId),
                    round: 1,
                    status: "active",
                    agentId: execution.currentAgentId,
                    agentRole: roleById(execution.currentAgentId),
                    summary: "Generating response...",
                    content: "",
                    metadata: {
                        loading: true,
                        loadingLabel: getLoadingCopy({
                            round: 1,
                            sourceRole: roleById(execution.currentAgentId),
                        }),
                    },
                });
            }
        }

        if (execution.activeRound === 2 && execution.currentAgentId) {
            const nodeId = `agent-${execution.currentAgentId}-r2`;
            const parentRole = roleById(execution.currentAgentId);
            const idx = nodes.findIndex((n) => n.id === nodeId);
            if (idx >= 0) {
                const n = nodes[idx];
                if (n.status === "hidden" || !n.content) {
                    nodes[idx] = {
                        ...n,
                        round: 2,
                        status: "active",
                        summary: n.summary || "Generating response...",
                        metadata: {
                            ...(n.metadata ?? {}),
                            loading: true,
                            loadingLabel: getLoadingCopy({
                                round: 2,
                                sourceRole: parentRole,
                                targetRole: relation?.targetRole ?? null,
                            }),
                        },
                    };
                }
            } else {
                nodes.push({
                    id: nodeId,
                    kind: "intermediate",
                    label: parentRole,
                    round: 2,
                    status: "active",
                    agentId: execution.currentAgentId,
                    agentRole: parentRole,
                    summary: "Generating response...",
                    content: "",
                    metadata: {
                        loading: true,
                        loadingLabel: getLoadingCopy({
                            round: 2,
                            sourceRole: parentRole,
                            targetRole: relation?.targetRole ?? null,
                        }),
                    },
                });
            }
        }

        if (execution.activeRound === 3 && execution.debateStatus === "running") {
            const synthIdx = nodes.findIndex((n) => n.id === "synthesis-node");
            if (synthIdx >= 0) {
                const node = nodes[synthIdx];
                if (node.status === "hidden" || !node.content) {
                    nodes[synthIdx] = {
                        ...node,
                        round: 3,
                        status: "active",
                        summary: node.summary || "Generating final synthesis...",
                        metadata: {
                            ...(node.metadata ?? {}),
                            loading: true,
                            loadingLabel: getLoadingCopy({ round: 3, sourceRole: "Synthesis" }),
                        },
                    };
                }
            } else {
                nodes.push({
                    id: "synthesis-node",
                    kind: "synthesis",
                    label: "Synthesis",
                    round: 3,
                    status: "active",
                    summary: "Generating final synthesis...",
                    content: "",
                    metadata: {
                        loading: true,
                        loadingLabel: getLoadingCopy({ round: 3, sourceRole: "Synthesis" }),
                    },
                });
            }
        }

        return nodes.map((node) => {
            if (node.content) {
                return {
                    ...node,
                    metadata: {
                        ...(node.metadata ?? {}),
                        loading: false,
                    },
                };
            }
            return node;
        });
    }, [graph.nodes, graph.edges, execution, agents, isLiveExecution]);

    const generatingNodeId = useMemo(() => getGeneratingNodeId(execution), [execution]);

    const narration = useMemo(
        () => deriveActiveNarration({
            execution,
            agents,
            nodes: renderNodes,
            edges: graph.edges,
        }),
        [execution, agents, renderNodes, graph.edges],
    );

    const agentOrder = useMemo(
        () => new Map(agents.map((a, idx) => [a.id, idx])),
        [agents],
    );

    const interactionOrder = useMemo(() => {
        const order = new Map<string, number>();
        let cursor = 0;
        for (const edge of graph.edges) {
            if (edge.round !== 2 || edge.kind === "initial") continue;
            if (!order.has(edge.source)) {
                order.set(edge.source, cursor++);
            }
            if (!order.has(edge.target)) {
                order.set(edge.target, cursor++);
            }
        }
        return order;
    }, [graph.edges]);

    const orderedVisibleNodes = useMemo(() => {
        return [...renderNodes]
            .filter((n) => n.status !== "hidden")
            .sort((a, b) => {
                const aRank = nodeRevealRank({ node: a, agentOrder, interactionOrder });
                const bRank = nodeRevealRank({ node: b, agentOrder, interactionOrder });
                if (aRank !== bRank) return aRank - bRank;
                return a.id.localeCompare(b.id);
            });
    }, [renderNodes, agentOrder, interactionOrder]);

    const visibleNodeIdsOrdered = useMemo(
        () => orderedVisibleNodes.map((n) => n.id),
        [orderedVisibleNodes],
    );
    const visibleNodeKey = useMemo(
        () => visibleNodeIdsOrdered.join("|"),
        [visibleNodeIdsOrdered],
    );

    const visibleEdgeIndexById = useMemo(
        () => new Map(graph.edges.map((edge, idx) => [edge.id, idx])),
        [graph.edges],
    );

    const orderedVisibleEdges = useMemo(() => {
        return [...graph.edges]
            .filter((edge) => edge.status !== "hidden")
            .sort((a, b) => edgeRevealRank(a, visibleEdgeIndexById) - edgeRevealRank(b, visibleEdgeIndexById));
    }, [graph.edges, visibleEdgeIndexById]);

    const visibleEdgeIdsOrdered = useMemo(
        () => orderedVisibleEdges.map((edge) => edge.id),
        [orderedVisibleEdges],
    );
    const visibleEdgeKey = useMemo(
        () => visibleEdgeIdsOrdered.join("|"),
        [visibleEdgeIdsOrdered],
    );

    const canonicalEdgeRefs = useMemo(
        () => orderedVisibleEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
        [orderedVisibleEdges],
    );

    // Memoize positions based on node STRUCTURE only (ids + kinds), not statuses
    const layoutKey = useMemo(() => {
        return renderNodes
            .map((n) => `${n.id}:${n.kind}`)
            .sort()
            .join("|");
    }, [renderNodes]);

    const positions = useMemo(() => computeLayout(renderNodes), [layoutKey, renderNodes]);

    useEffect(() => {
        const revealAllCompletedHistory = openedAsCompleted && !isLiveExecution;
        syncPlaybackFromCanonical({
            canonicalNodeIds: visibleNodeIdsOrdered,
            canonicalEdges: canonicalEdgeRefs,
            isLiveExecution,
            revealAll: revealAllCompletedHistory,
        });
    }, [
        canonicalEdgeRefs,
        isLiveExecution,
        openedAsCompleted,
        syncPlaybackFromCanonical,
        visibleNodeIdsOrdered,
        visibleNodeKey,
        visibleEdgeIdsOrdered,
        visibleEdgeKey,
    ]);

    // Reveal queue auto-run: one item at a time, deterministic delay.
    useEffect(() => {
        if (playbackMode !== "auto") return;
        if (playbackQueue.length === 0) return;
        autoRunTimerRef.current = setTimeout(() => {
            revealNextVisual();
        }, 300 + Math.floor(Math.random() * 301));
        return () => {
            if (autoRunTimerRef.current) clearTimeout(autoRunTimerRef.current);
        };
    }, [playbackMode, playbackQueue.length, revealNextVisual]);

    useEffect(() => {
        const prevSet = prevRevealedEdgeSetRef.current;
        const nextSet = new Set(revealedEdgeIds);
        for (const edgeId of revealedEdgeIds) {
            if (!prevSet.has(edgeId)) {
                markEdgeFresh(edgeId);
            }
        }
        prevRevealedEdgeSetRef.current = nextSet;
    }, [revealedEdgeIds, markEdgeFresh]);

    // Count visible nodes (after reveal queue)
    const visibleCount = revealedNodeIds.length;

    // Re-fit view when visible node count transitions from 0 → N
    useEffect(() => {
        if (prevVisibleCountRef.current === 0 && visibleCount > 0) {
            const t = setTimeout(() => rfInstance.current?.fitView({ padding: 0.3 }), 200);
            return () => clearTimeout(t);
        }
        prevVisibleCountRef.current = visibleCount;
    }, [visibleCount]);

    const onInit = useCallback((instance: ReactFlowInstance) => {
        rfInstance.current = instance;
    }, []);

    // ESC key to deselect nodes and clear focus
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                selectNode(null);
                clearFocus();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectNode, clearFocus]);

    const revealedNodeSet = useMemo(() => new Set(revealedNodeIds), [revealedNodeIds]);
    const revealedEdgeSet = useMemo(() => new Set(revealedEdgeIds), [revealedEdgeIds]);
    const freshEdgeSet = useMemo(() => new Set(freshEdgeIds), [freshEdgeIds]);

    const flowNodes: Node[] = useMemo(() => {
        const baseNodes = renderNodes
            .filter((n) => n.status !== "hidden" && revealedNodeSet.has(n.id))
            .map((n) => {
                const metadata = {
                    ...(n.metadata ?? {}),
                    loading:
                        execution.debateStatus === "completed" || execution.debateStatus === "failed"
                            ? false
                            : n.metadata?.["loading"],
                };
                const relevant = isNodeRelevant(n, selectedRound);
                const dimmedByRound = selectedRound !== null && !relevant;
                const dimmedBySelection = selectedNodeId !== null && n.id !== selectedNodeId;
                const dimmedByGeneration = Boolean(
                    generatingNodeId
                    && execution.debateStatus === "running"
                    && n.id !== generatingNodeId,
                );
                const isGeneratingFocus = Boolean(
                    generatingNodeId
                    && execution.debateStatus === "running"
                    && n.id === generatingNodeId,
                );
                return {
                    id: n.id,
                    type: n.kind,
                    position: positions.get(n.id) ?? { x: 0, y: 0 },
                    data: {
                        ...n,
                        metadata,
                        dimmedByRound,
                        dimmedBySelection,
                        dimmedByGeneration,
                        isGeneratingFocus,
                        completionPulse: completionPulse && n.id === "synthesis-node",
                    },
                    selected: n.id === selectedNodeId,
                };
            });

        // Cycle band labels: visually separate each follow-up cycle.
        const cycleSet = Array.from(
            new Set(
                renderNodes
                    .filter((n) =>
                        (n.kind === "followup-question"
                            || n.kind === "followup-agent"
                            || n.kind === "followup-intermediate"
                            || n.kind === "followup-synthesis")
                        && revealedNodeSet.has(n.id),
                    )
                    .map((n) => n.cycle ?? 0)
                    .filter((c) => c >= 2),
            ),
        ).sort((a, b) => a - b);

        const labelNodes: Node[] = [];
        for (const cycle of cycleSet) {
            const fuq = renderNodes.find(
                (n) => n.kind === "followup-question" && n.cycle === cycle,
            );
            const pos = fuq ? positions.get(fuq.id) : undefined;
            if (!pos) continue;
            labelNodes.push({
                id: `cycle-label-${cycle}`,
                type: "cycle-label",
                position: { x: pos.x - 380, y: pos.y - 20 },
                data: {
                    label: `Follow-up #${cycle - 1}`,
                    subLabel: "user follow-up cycle",
                },
                draggable: false,
                selectable: false,
                focusable: false,
                deletable: false,
                zIndex: -1,
            });
        }

        return [...labelNodes, ...baseNodes];
    }, [
        renderNodes,
        revealedNodeSet,
        execution.debateStatus,
        selectedRound,
        selectedNodeId,
        generatingNodeId,
        completionPulse,
        positions,
    ]);

    const flowEdges: Edge[] = useMemo(() => {
        return graph.edges
            .filter((e) =>
                e.status !== "hidden"
                && revealedEdgeSet.has(e.id)
                && revealedNodeSet.has(e.source)
                && revealedNodeSet.has(e.target),
            )
            .map((e: DebateGraphEdge) => {
                const relevantByRound = isEdgeRelevant(e, selectedRound);
                const dimmedByRound = selectedRound !== null && !relevantByRound;
                // Also dim edges not connected to selected node
                const dimmedBySelection = selectedNodeId !== null
                    && e.source !== selectedNodeId
                    && e.target !== selectedNodeId;
                const dimmedByGeneration = Boolean(
                    generatingNodeId
                    && execution.debateStatus === "running"
                    && e.source !== generatingNodeId
                    && e.target !== generatingNodeId,
                );
                const dimmed = dimmedByRound || dimmedBySelection || dimmedByGeneration;
                const draw = e.status === "drawing" || freshEdgeSet.has(e.id);
                const pulse = e.kind === "challenges" && freshEdgeSet.has(e.id);
                return {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    type: toFlowEdgeType(e.kind),
                    animated: (e.status === "active" || draw) && !dimmed,
                    label: dimmed ? undefined : e.label,
                    data: { status: e.status, dimmed, draw, pulse },
                    style: {
                        stroke: e.status === "failed" ? "#ef4444" : edgeColor(e.kind),
                        strokeWidth: dimmed ? 1 : (pulse ? 2.8 : e.status === "active" ? 2.5 : e.status === "failed" ? 2.2 : 1.8),
                        opacity: dimmed ? 0.12 : 1,
                    },
                };
            });
    }, [
        graph.edges,
        revealedEdgeSet,
        freshEdgeSet,
        selectedRound,
        selectedNodeId,
        generatingNodeId,
        execution.debateStatus,
    ]);

    const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

    // Sync React Flow state with store
    useEffect(() => {
        setNodes(flowNodes);
    }, [flowNodes, setNodes]);

    useEffect(() => {
        setEdges(flowEdges);
    }, [flowEdges, setEdges]);

    useEffect(() => {
        setRenderedCounts(flowNodes.length, flowEdges.length);
    }, [flowNodes.length, flowEdges.length, setRenderedCounts]);

    useEffect(() => {
        if (!import.meta.env.DEV) return;
        // eslint-disable-next-line no-console
        console.log("[RENDER] rendered nodes", flowNodes.length);
    }, [flowNodes.length]);

    const onNodeClick: NodeMouseHandler = useCallback(
        (_event, node) => {
            selectNode(node.id === selectedNodeId ? null : node.id);
        },
        [selectNode, selectedNodeId],
    );

    const onPaneClick = useCallback(() => {
        selectNode(null);
        clearFocus();
    }, [selectNode, clearFocus]);

    // Empty state
    if (renderNodes.length === 0) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-agora-bg">
                <div className="text-center space-y-3">
                    <div className="text-4xl">🌐</div>
                    <p className="text-agora-text-muted text-sm">
                        Start a debate to see the thinking graph
                    </p>
                </div>
            </div>
        );
    }

    // Canonical graph exists but nothing has been revealed yet.
    if (flowNodes.length === 0) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-agora-bg">
                <div className="text-center space-y-3">
                    <div className="text-3xl">⏳</div>
                    <p className="text-agora-text-muted text-sm">
                        {playbackQueue.length > 0
                            ? playbackMode === "paused"
                                ? "A response is ready. Click Next Step to reveal it."
                                : "Auto Run is revealing responses..."
                            : "Waiting for the first agent response..."}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onPaneClick={onPaneClick}
                onInit={onInit}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                fitView
                fitViewOptions={{ padding: 0.35 }}
                minZoom={0.3}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                className="bg-agora-bg"
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="#1f2937"
                />
                <Controls
                    showInteractive={false}
                    className="!bg-agora-surface !border-agora-border"
                />
                <MiniMap
                    nodeStrokeColor="#4b5563"
                    nodeColor={(n) => {
                        if (n.type === "question") return "#6366f1";
                        if (n.type === "synthesis") return "#a78bfa";
                        return "#4b5563";
                    }}
                    maskColor="rgba(10, 14, 26, 0.8)"
                    className="!bg-agora-surface"
                />
            </ReactFlow>

            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-3">
                <AnimatePresence>
                    {(execution.debateStatus === "queued" || execution.debateStatus === "running") && (
                        <motion.div
                            key="active-narration"
                            initial={{ opacity: 0, y: -10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="max-w-[640px] w-full rounded-xl border border-indigo-400/30 bg-indigo-500/12 backdrop-blur-sm px-4 py-2.5 shadow-lg shadow-indigo-900/20"
                        >
                            <div className="text-sm font-semibold text-indigo-100 truncate">
                                {narration.title}
                            </div>
                            <div className="text-[11px] text-indigo-200/80 truncate">
                                {narration.sublabel}
                            </div>
                            {narration.relation && (
                                <div className="mt-1 text-[11px] text-indigo-300/90 font-medium tracking-wide">
                                    {narration.relation}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {showCompletionBanner && (
                        <motion.div
                            key="completion-badge"
                            initial={{ opacity: 0, y: -8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.96 }}
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 shadow-lg shadow-emerald-900/25"
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                                <motion.span
                                    initial={{ scale: 0.7, opacity: 0.5 }}
                                    animate={{ scale: [0.8, 1.15, 1], opacity: [0.7, 1, 1] }}
                                    transition={{ duration: 0.45, ease: "easeOut" }}
                                    className="inline-block"
                                >
                                    ✓
                                </motion.span>
                                Debate Complete
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
