import { useCallback, useEffect, useMemo, useRef } from "react";
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

import { useGraphStore } from "../model/graph.store";
import { usePlaybackStore } from "../model/playback.store";
import type { DebateGraphNode, DebateGraphEdge, GraphEdgeKind } from "../model/graph.types";

import QuestionNode from "./nodes/QuestionNode";
import AgentNode from "./nodes/AgentNode";
import SynthesisNode from "./nodes/SynthesisNode";
import CritiqueEdge from "./edges/CritiqueEdge";
import SupportEdge from "./edges/SupportEdge";
import InquiryEdge from "./edges/InquiryEdge";

// ── Node type registry ────────────────────────────────────────────────

const nodeTypes = {
    question: QuestionNode,
    agent: AgentNode,
    synthesis: SynthesisNode,
    intermediate: AgentNode,
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
    // Agent nodes are relevant to rounds 1 and 2 (they appear in round 1)
    return selectedRound === 1 || selectedRound === 2;
}

/** Check if an edge should be highlighted given the selected round */
function isEdgeRelevant(e: DebateGraphEdge, selectedRound: number | null): boolean {
    if (selectedRound === null) return true;
    return e.round === selectedRound;
}

// ── Component ─────────────────────────────────────────────────────────

export default function DebateGraphCanvas() {
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const forceRevealAll = useGraphStore((s) => s.forceRevealAll);
    const clearFocus = useGraphStore((s) => s.clearFocus);
    const selectedRound = usePlaybackStore((s) => s.selectedRound);
    const recoveryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevVisibleCountRef = useRef(0);
    const rfInstance = useRef<ReactFlowInstance | null>(null);

    // Memoize positions based on node STRUCTURE only (ids + kinds), not statuses
    const layoutKey = useMemo(() => {
        return graph.nodes
            .map((n) => `${n.id}:${n.kind}`)
            .sort()
            .join("|");
    }, [graph.nodes]);

    const positions = useMemo(() => computeLayout(graph.nodes), [layoutKey]);

    // Count visible nodes (anything not hidden)
    const visibleCount = graph.nodes.filter((n) => n.status !== "hidden").length;

    // Recovery: if nodes exist but ALL are hidden for 4s, force-reveal
    const allHidden = graph.nodes.length > 0 && graph.nodes.every((n) => n.status === "hidden");
    useEffect(() => {
        if (allHidden) {
            recoveryRef.current = setTimeout(() => {
                const g = useGraphStore.getState().graph;
                const stillAllHidden = g.nodes.length > 0 && g.nodes.every((n) => n.status === "hidden");
                if (stillAllHidden) {
                    console.warn("[Agora] Canvas recovery: all nodes hidden, forcing reveal");
                    forceRevealAll();
                }
            }, 4000);
        }
        return () => {
            if (recoveryRef.current) clearTimeout(recoveryRef.current);
        };
    }, [allHidden, forceRevealAll]);

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

    const flowNodes: Node[] = useMemo(() => {
        return graph.nodes
            .filter((n) => n.status !== "hidden")
            .map((n) => {
                const relevant = isNodeRelevant(n, selectedRound);
                const dimmedByRound = selectedRound !== null && !relevant;
                const dimmedBySelection = selectedNodeId !== null && n.id !== selectedNodeId;
                return {
                    id: n.id,
                    type: n.kind,
                    position: positions.get(n.id) ?? { x: 0, y: 0 },
                    data: { ...n, dimmedByRound, dimmedBySelection },
                    selected: n.id === selectedNodeId,
                };
            });
    }, [graph.nodes, positions, selectedNodeId, selectedRound]);

    const flowEdges: Edge[] = useMemo(() => {
        return graph.edges
            .filter((e) => e.status !== "hidden")
            .map((e: DebateGraphEdge) => {
                const relevantByRound = isEdgeRelevant(e, selectedRound);
                const dimmedByRound = selectedRound !== null && !relevantByRound;
                // Also dim edges not connected to selected node
                const dimmedBySelection = selectedNodeId !== null
                    && e.source !== selectedNodeId
                    && e.target !== selectedNodeId;
                const dimmed = dimmedByRound || dimmedBySelection;
                return {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    type: toFlowEdgeType(e.kind),
                    animated: e.status === "active" && !dimmed,
                    label: dimmed ? undefined : e.label,
                    data: { status: e.status, dimmed },
                    style: {
                        stroke: edgeColor(e.kind),
                        strokeWidth: dimmed ? 1 : (e.status === "active" ? 2.5 : 1.8),
                        opacity: dimmed ? 0.12 : 1,
                    },
                };
            });
    }, [graph.edges, selectedRound]);

    const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

    // Sync React Flow state with store
    useEffect(() => {
        setNodes(flowNodes);
    }, [flowNodes, setNodes]);

    useEffect(() => {
        setEdges(flowEdges);
    }, [flowEdges, setEdges]);

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
    if (graph.nodes.length === 0) {
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

    // All nodes hidden — animation is preparing
    if (allHidden) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-agora-bg">
                <div className="text-center space-y-3">
                    <div className="text-3xl animate-pulse">🎬</div>
                    <p className="text-agora-text-muted text-sm">
                        Preparing cinematic replay…
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
        </div>
    );
}
