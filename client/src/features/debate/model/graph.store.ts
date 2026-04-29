import { create } from "zustand";
import type { AgentDTO, SessionDetailDTO, WsEvent } from "../api/debate.types";
import type {
    DebateGraph,
    DebateGraphNode,
    DebateGraphEdge,
    GraphNodeStatus,
    GraphEdgeStatus,
} from "./graph.types";
import { applyWsEventToGraph, mapSessionToGraph } from "./graph.mapper";

interface GraphStore {
    graph: DebateGraph;
    selectedNodeId: string | null;
    focusedNodeId: string | null;

    hydrateFromSession: (session: SessionDetailDTO) => void;
    /** Hydrate but keep all nodes hidden (for animated replay) */
    hydrateHidden: (session: SessionDetailDTO) => void;
    /** Merge server snapshot without resetting animation-visible statuses. */
    mergeFromSession: (session: SessionDetailDTO) => void;
    applyEvent: (event: WsEvent, agents: AgentDTO[]) => void;
    selectNode: (nodeId: string | null) => void;
    getNode: (nodeId: string) => DebateGraphNode | undefined;

    /* Focus system */
    setFocus: (nodeId: string | null) => void;
    clearFocus: () => void;

    /* Animation-driven state mutations */
    setNodeStatus: (nodeId: string, status: GraphNodeStatus) => void;
    setEdgeStatus: (edgeId: string, status: GraphEdgeStatus) => void;
    /** Ensure a node exists (for live WS when mapper hasn't run yet) */
    ensureNode: (node: DebateGraphNode) => void;
    /** Ensure an edge exists */
    ensureEdge: (edge: DebateGraphEdge) => void;
    /** Update a node's summary/content */
    updateNodeData: (nodeId: string, data: Partial<DebateGraphNode>) => void;
    /** Force all hidden nodes/edges to visible (recovery path) */
    forceRevealAll: () => void;
    /** Mark currently active nodes as failed when turn fails. */
    markRunningNodesFailed: () => void;

    reset: () => void;
}

const emptyGraph: DebateGraph = { nodes: [], edges: [] };

const NODE_STATUS_RANK: Record<string, number> = {
    hidden: 0,
    entering: 1,
    visible: 2,
    active: 3,
    completed: 4,
    failed: 5,
};

const EDGE_STATUS_RANK: Record<string, number> = {
    hidden: 0,
    drawing: 1,
    visible: 2,
    active: 3,
    completed: 4,
    failed: 5,
};

function preferNodeStatus(previous: string, next: string): string {
    return (NODE_STATUS_RANK[previous] ?? 0) > (NODE_STATUS_RANK[next] ?? 0)
        ? previous
        : next;
}

function preferEdgeStatus(previous: string, next: string): string {
    return (EDGE_STATUS_RANK[previous] ?? 0) > (EDGE_STATUS_RANK[next] ?? 0)
        ? previous
        : next;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
    graph: emptyGraph,
    selectedNodeId: null,
    focusedNodeId: null,

    hydrateFromSession: (session) => {
        const graph = mapSessionToGraph(session);
        set((s) => ({
            graph,
            selectedNodeId: s.selectedNodeId && graph.nodes.some((n) => n.id === s.selectedNodeId)
                ? s.selectedNodeId
                : null,
            focusedNodeId: s.focusedNodeId && graph.nodes.some((n) => n.id === s.focusedNodeId)
                ? s.focusedNodeId
                : null,
        }));
    },

    hydrateHidden: (session) => {
        const graph = mapSessionToGraph(session);
        // Override all statuses to hidden
        const nodes = graph.nodes.map((n) => ({ ...n, status: "hidden" as const }));
        const edges = graph.edges.map((e) => ({ ...e, status: "hidden" as const }));
        set((s) => ({
            graph: { nodes, edges },
            selectedNodeId: s.selectedNodeId && nodes.some((n) => n.id === s.selectedNodeId)
                ? s.selectedNodeId
                : null,
            focusedNodeId: s.focusedNodeId && nodes.some((n) => n.id === s.focusedNodeId)
                ? s.focusedNodeId
                : null,
        }));
    },

    mergeFromSession: (session) => {
        const nextGraph = mapSessionToGraph(session);
        set((s) => {
            const prevNodes = new Map(s.graph.nodes.map((n) => [n.id, n]));
            const prevEdges = new Map(s.graph.edges.map((e) => [e.id, e]));

            const mergedNodes = nextGraph.nodes.map((node) => {
                const prev = prevNodes.get(node.id);
                if (!prev) return node;
                const metadata = { ...(prev.metadata ?? {}), ...(node.metadata ?? {}) };
                if (node.content || node.summary) {
                    metadata["loading"] = false;
                }
                return {
                    ...node,
                    status: preferNodeStatus(String(prev.status), String(node.status)) as GraphNodeStatus,
                    summary: node.summary || prev.summary,
                    content: node.content || prev.content,
                    metadata,
                };
            });

            // Preserve any synthetic/loading nodes that are not yet in the server snapshot.
            for (const prev of s.graph.nodes) {
                if (!mergedNodes.some((n) => n.id === prev.id) && prev.status !== "hidden") {
                    mergedNodes.push(prev);
                }
            }

            const mergedEdges = nextGraph.edges.map((edge) => {
                const prev = prevEdges.get(edge.id);
                if (!prev) return edge;
                return {
                    ...edge,
                    status: preferEdgeStatus(String(prev.status), String(edge.status)) as GraphEdgeStatus,
                };
            });

            for (const prev of s.graph.edges) {
                if (!mergedEdges.some((e) => e.id === prev.id) && prev.status !== "hidden") {
                    mergedEdges.push(prev);
                }
            }

            return {
                graph: { nodes: mergedNodes, edges: mergedEdges },
                selectedNodeId: s.selectedNodeId && mergedNodes.some((n) => n.id === s.selectedNodeId)
                    ? s.selectedNodeId
                    : null,
                focusedNodeId: s.focusedNodeId && mergedNodes.some((n) => n.id === s.focusedNodeId)
                    ? s.focusedNodeId
                    : null,
            };
        });
    },

    applyEvent: (event, agents) => {
        const current = get().graph;
        const updated = applyWsEventToGraph(current, event, agents);
        set({ graph: updated });
    },

    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

    getNode: (nodeId) => get().graph.nodes.find((n) => n.id === nodeId),

    // ── Focus ────────────────────────────────────────────────

    setFocus: (nodeId) => set({ focusedNodeId: nodeId }),
    clearFocus: () => set({ focusedNodeId: null }),

    // ── Animation mutations ──────────────────────────────────

    setNodeStatus: (nodeId, status) => {
        set((s) => ({
            graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) =>
                    n.id === nodeId ? { ...n, status } : n,
                ),
            },
        }));
    },

    setEdgeStatus: (edgeId, status) => {
        set((s) => ({
            graph: {
                ...s.graph,
                edges: s.graph.edges.map((e) =>
                    e.id === edgeId ? { ...e, status } : e,
                ),
            },
        }));
    },

    ensureNode: (node) => {
        set((s) => {
            const exists = s.graph.nodes.find((n) => n.id === node.id);
            if (exists) {
                // Node exists — merge content fields if they were previously empty
                if (
                    (node.summary && !exists.summary) ||
                    (node.content && !exists.content) ||
                    (node.label && exists.label !== node.label)
                ) {
                    return {
                        graph: {
                            ...s.graph,
                            nodes: s.graph.nodes.map((n) =>
                                n.id === node.id
                                    ? {
                                        ...n,
                                        summary: n.summary || node.summary,
                                        content: n.content || node.content,
                                        label: node.label || n.label,
                                    }
                                    : n,
                            ),
                        },
                    };
                }
                return s;
            }
            return {
                graph: { ...s.graph, nodes: [...s.graph.nodes, node] },
            };
        });
    },

    ensureEdge: (edge) => {
        set((s) => {
            const exists = s.graph.edges.find((e) => e.id === edge.id);
            if (exists) return s;
            return {
                graph: { ...s.graph, edges: [...s.graph.edges, edge] },
            };
        });
    },

    updateNodeData: (nodeId, data) => {
        set((s) => ({
            graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) =>
                    n.id === nodeId ? { ...n, ...data } : n,
                ),
            },
        }));
    },

    forceRevealAll: () => {
        set((s) => ({
            graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) =>
                    n.status === "hidden" ? { ...n, status: "visible" as const } : n,
                ),
                edges: s.graph.edges.map((e) =>
                    e.status === "hidden" ? { ...e, status: "visible" as const } : e,
                ),
            },
        }));
    },

    markRunningNodesFailed: () => {
        set((s) => ({
            graph: {
                ...s.graph,
                nodes: s.graph.nodes.map((n) =>
                    n.status === "active" || n.status === "entering"
                        ? { ...n, status: "failed" as GraphNodeStatus }
                        : n,
                ),
            },
        }));
    },

    reset: () =>
        set({ graph: emptyGraph, selectedNodeId: null, focusedNodeId: null }),
}));
