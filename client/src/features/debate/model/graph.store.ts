import { create } from "zustand";
import type { AgentDTO, SessionDetailDTO, WsEvent } from "../api/debate.types";
import type {
    DebateGraph,
    DebateGraphNode,
    DebateGraphEdge,
    GraphNodeStatus,
    GraphEdgeStatus,
    GraphEdgeKind,
} from "./graph.types";
import { applyWsEventToGraph, mapSessionToGraph } from "./graph.mapper";

interface GraphStore {
    graph: DebateGraph;
    selectedNodeId: string | null;
    focusedNodeId: string | null;

    hydrateFromSession: (session: SessionDetailDTO) => void;
    /** Hydrate but keep all nodes hidden (for animated replay) */
    hydrateHidden: (session: SessionDetailDTO) => void;
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

    reset: () => void;
}

const emptyGraph: DebateGraph = { nodes: [], edges: [] };

export const useGraphStore = create<GraphStore>((set, get) => ({
    graph: emptyGraph,
    selectedNodeId: null,
    focusedNodeId: null,

    hydrateFromSession: (session) => {
        const graph = mapSessionToGraph(session);
        set({ graph });
    },

    hydrateHidden: (session) => {
        const graph = mapSessionToGraph(session);
        // Override all statuses to hidden
        const nodes = graph.nodes.map((n) => ({ ...n, status: "hidden" as const }));
        const edges = graph.edges.map((e) => ({ ...e, status: "hidden" as const }));
        set({ graph: { nodes, edges } });
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

    reset: () =>
        set({ graph: emptyGraph, selectedNodeId: null, focusedNodeId: null }),
}));
