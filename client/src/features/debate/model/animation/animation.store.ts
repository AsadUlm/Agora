/**
 * Animation Store — orchestrates the cinematic playback of debate steps.
 *
 * Responsibilities:
 *   1. Hold an ordered queue of AnimationSteps
 *   2. Process steps one-by-one, respecting duration + delay scaled by speed
 *   3. Expose play / pause / next / reset controls
 *   4. Dispatch graph mutations & moderator updates per step
 */

import { create } from "zustand";
import type { AnimationStep } from "./animation.types";
import type { GraphEdgeAnimState, GraphNodeAnimState } from "./animation.types";
import { useGraphStore } from "../graph.store";
import { useModeratorStore } from "../moderator.store";

// ── Graph animation state (kept here so animations own it) ───────────

export interface NodeAnimState {
    state: GraphNodeAnimState;
}

export interface EdgeAnimState {
    state: GraphEdgeAnimState;
}

interface AnimationStore {
    /* queue */
    queue: AnimationStep[];
    currentStepIndex: number;
    /** Total steps enqueued so far (including already-processed) */
    totalSteps: number;

    /* playback */
    isPlaying: boolean;
    isPaused: boolean;
    speed: number; // 1 = normal

    /* focus */
    focusedNodeId: string | null;

    /* Current step description for moderator synchronization */
    currentStepDescription: string;

    /* per-element anim state — keyed by node/edge id */
    nodeStates: Record<string, NodeAnimState>;
    edgeStates: Record<string, EdgeAnimState>;

    /* actions */
    enqueueSteps: (steps: AnimationStep[]) => void;
    play: () => void;
    pause: () => void;
    resume: () => void;
    next: () => void;
    reset: () => void;
    setSpeed: (speed: number) => void;
    /** Called internally by the step runner */
    _processStep: (step: AnimationStep) => void;
    _scheduleNext: () => void;
    _timerId: ReturnType<typeof setTimeout> | null;
}

let _timerId: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
    if (_timerId !== null) {
        clearTimeout(_timerId);
        _timerId = null;
    }
}

export const useAnimationStore = create<AnimationStore>((set, get) => ({
    queue: [],
    currentStepIndex: -1,
    totalSteps: 0,
    isPlaying: false,
    isPaused: false,
    speed: 1,
    focusedNodeId: null,
    currentStepDescription: "",
    nodeStates: {},
    edgeStates: {},
    _timerId: null,

    // ── Enqueue ─────────────────────────────────────────────────

    enqueueSteps: (steps) => {
        set((s) => ({
            queue: [...s.queue, ...steps],
            totalSteps: s.totalSteps + steps.length,
        }));

        // Auto-play if already playing
        const state = get();
        if (state.isPlaying && !state.isPaused) {
            // If we were idle (finished all previous steps), kick off again
            if (state.currentStepIndex >= state.queue.length - steps.length - 1) {
                get()._scheduleNext();
            }
        }
    },

    // ── Play / Pause / Resume ───────────────────────────────────

    play: () => {
        set({ isPlaying: true, isPaused: false });
        get()._scheduleNext();
    },

    pause: () => {
        clearTimer();
        set({ isPaused: true });
    },

    resume: () => {
        set({ isPaused: false });
        get()._scheduleNext();
    },

    // ── Manual next ─────────────────────────────────────────────

    next: () => {
        clearTimer();
        const { queue, currentStepIndex } = get();
        const nextIdx = currentStepIndex + 1;
        if (nextIdx < queue.length) {
            const step = queue[nextIdx];
            // Extract step description for moderator sync
            const description = (step.meta?.["description"] as string) ?? "";
            set({ currentStepIndex: nextIdx, currentStepDescription: description });
            get()._processStep(step);
            // If auto-playing, schedule the one after
            if (get().isPlaying && !get().isPaused) {
                get()._scheduleNext();
            }
        }
    },

    // ── Reset ───────────────────────────────────────────────────

    reset: () => {
        clearTimer();
        set({
            queue: [],
            currentStepIndex: -1,
            totalSteps: 0,
            isPlaying: false,
            isPaused: false,
            focusedNodeId: null,
            currentStepDescription: "",
            nodeStates: {},
            edgeStates: {},
        });
    },

    setSpeed: (speed) => set({ speed }),

    // ── Internal: process a single step ─────────────────────────

    _processStep: (step) => {
        try {
            const graphStore = useGraphStore.getState();

            switch (step.type) {
                case "node_enter":
                    if (step.targetId) {
                        // Ensure the node exists in graph before setting status
                        graphStore.setNodeStatus(step.targetId, "entering");
                        set((s) => ({
                            nodeStates: {
                                ...s.nodeStates,
                                [step.targetId!]: { state: "entering" },
                            },
                        }));
                        // After duration → visible
                        const dur = Math.max(0, (step.duration ?? 500) / (get().speed || 1));
                        setTimeout(() => {
                            try {
                                graphStore.setNodeStatus(step.targetId!, "visible");
                                set((s) => ({
                                    nodeStates: {
                                        ...s.nodeStates,
                                        [step.targetId!]: { state: "visible" },
                                    },
                                }));
                            } catch (e) {
                                console.warn("[Agora] node_enter visible transition failed:", e);
                            }
                        }, dur);
                    }
                    break;

                case "node_activate":
                    if (step.targetId) {
                        graphStore.setNodeStatus(step.targetId, "active");
                        set((s) => ({
                            nodeStates: {
                                ...s.nodeStates,
                                [step.targetId!]: { state: "active" },
                            },
                        }));
                    }
                    break;

                case "node_complete":
                    if (step.targetId) {
                        graphStore.setNodeStatus(step.targetId, "completed");
                        set((s) => ({
                            nodeStates: {
                                ...s.nodeStates,
                                [step.targetId!]: { state: "completed" },
                            },
                        }));
                    }
                    break;

                case "edge_draw":
                    if (step.edge) {
                        // Ensure edge exists in graph store
                        graphStore.ensureEdge({
                            id: step.edge.id,
                            source: step.edge.source,
                            target: step.edge.target,
                            kind: step.edge.kind as import("../graph.types").GraphEdgeKind,
                            round: (step.meta?.["round"] as number) ?? 0,
                            status: "drawing",
                        });
                        graphStore.setEdgeStatus(step.edge.id, "drawing");
                        set((s) => ({
                            edgeStates: {
                                ...s.edgeStates,
                                [step.edge!.id]: { state: "drawing" },
                            },
                        }));
                        const edgeDur = Math.max(0, (step.duration ?? 600) / (get().speed || 1));
                        setTimeout(() => {
                            try {
                                graphStore.setEdgeStatus(step.edge!.id, "visible");
                                set((s) => ({
                                    edgeStates: {
                                        ...s.edgeStates,
                                        [step.edge!.id]: { state: "visible" },
                                    },
                                }));
                            } catch (e) {
                                console.warn("[Agora] edge_draw visible transition failed:", e);
                            }
                        }, edgeDur);
                    }
                    break;

                case "focus_node":
                    if (step.targetId) {
                        graphStore.setFocus(step.targetId);
                        set({ focusedNodeId: step.targetId });
                    }
                    break;

                case "unfocus_all":
                    graphStore.clearFocus();
                    set({ focusedNodeId: null });
                    break;

                case "moderator_update":
                    if (step.moderator) {
                        const updates: Record<string, unknown> = {};
                        if (step.moderator.status) updates["status"] = step.moderator.status;
                        if (step.moderator.explanation)
                            updates["explanation"] = step.moderator.explanation;
                        if (step.moderator.watchFor)
                            updates["watchFor"] = step.moderator.watchFor;
                        useModeratorStore.setState(updates);
                    }
                    break;

                case "delay":
                    // pure wait — nothing to do, the scheduling handles the delay
                    break;
            }
        } catch (e) {
            console.error("[Agora] _processStep error (step will be skipped):", e);
        }
    },

    // ── Internal: schedule the next step after current step's delay ──

    _scheduleNext: () => {
        clearTimer();
        const { queue, currentStepIndex, isPlaying, isPaused, speed } = get();

        if (!isPlaying || isPaused) return;

        const nextIdx = currentStepIndex + 1;
        if (nextIdx >= queue.length) {
            // Queue exhausted — verify graph has visible nodes, force-reveal if not
            setTimeout(() => {
                const g = useGraphStore.getState().graph;
                const anyVisible = g.nodes.some(
                    (n) => n.status !== "hidden",
                );
                if (!anyVisible && g.nodes.length > 0) {
                    console.warn(
                        "[Agora] Animation finished but no visible nodes — forcing reveal",
                    );
                    useGraphStore.getState().forceRevealAll();
                }
            }, 300);
            return;
        }

        // Calculate wait = current step's (duration + delay) scaled by speed
        const currentStep = currentStepIndex >= 0 ? queue[currentStepIndex] : null;
        const wait = currentStep
            ? ((currentStep.duration ?? 0) + (currentStep.delay ?? 0)) / (speed || 1)
            : 0; // first step: immediate

        _timerId = setTimeout(() => {
            const s = get();
            if (!s.isPlaying || s.isPaused) return;
            const idx = s.currentStepIndex + 1;
            if (idx < s.queue.length) {
                const step = s.queue[idx];
                const description = (step.meta?.["description"] as string) ?? "";
                set({ currentStepIndex: idx, currentStepDescription: description });
                try {
                    s._processStep(step);
                } catch (e) {
                    console.error("[Agora] Step processing failed:", e);
                }
                s._scheduleNext();
            }
        }, Math.max(0, wait));
    },
}));
