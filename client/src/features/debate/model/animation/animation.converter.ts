/**
 * WS Event → Animation Steps converter.
 *
 * Translates raw WebSocket events into cinematic animation sequences
 * that the animation store can play step-by-step.
 *
 * Also provides `sessionToAnimationSteps` which converts a fully-loaded
 * session into a complete replay timeline.
 */

import type {
    AgentDTO,
    MessageDTO,
    SessionDetailDTO,
    WsEvent,
} from "../../api/debate.types";
import type { AnimationStep } from "./animation.types";
import { isErrorPayload, isErrorText, shouldSkipGraphInference } from "../error-normalizer";

let _stepCounter = 0;
function stepId(): string {
    return `step-${++_stepCounter}`;
}

const QUESTION_NODE_ID = "question-node";
const SYNTHESIS_NODE_ID = "synthesis-node";

// ── Timing constants (ms) — will be scaled by playback speed ──────

const T = {
    NODE_ENTER: 500,
    NODE_ACTIVATE: 300,
    NODE_COMPLETE: 200,
    EDGE_DRAW: 600,
    EDGE_DRAW_CRITIQUE: 400,
    FOCUS: 100,
    STEP_GAP: 300,
    ROUND_GAP: 600,
    AGENT_GAP: 400,
} as const;

// ── Convert a full session to animation steps (for replay) ──────────

export function sessionToAnimationSteps(
    session: SessionDetailDTO,
): AnimationStep[] {
    const steps: AnimationStep[] = [];
    const agents = session.agents ?? [];
    const turn = session.latest_turn;

    if (!turn) return steps;

    // 1. Question node appears
    steps.push({
        id: stepId(),
        type: "node_enter",
        targetId: QUESTION_NODE_ID,
        duration: T.NODE_ENTER,
        delay: T.STEP_GAP,
        meta: { description: "The question is presented" },
    });
    steps.push({
        id: stepId(),
        type: "focus_node",
        targetId: QUESTION_NODE_ID,
        duration: T.FOCUS,
        delay: T.ROUND_GAP,
        meta: { description: "Focus on the question" },
    });

    for (const round of turn.rounds) {
        const rn = round.round_number;

        // Moderator update for round start
        steps.push({
            id: stepId(),
            type: "moderator_update",
            duration: 0,
            delay: T.STEP_GAP,
            moderator: moderatorTextForRound(rn, "start"),
        });

        if (rn === 1) {
            steps.push(...buildRound1Steps(round.messages, agents));
        } else if (rn === 2) {
            steps.push(...buildRound2Steps(round.messages, agents));
        } else if (rn === 3) {
            steps.push(
                ...buildRound3Steps(round.messages, agents, turn.final_summary),
            );
        }

        // Moderator update for round end
        steps.push({
            id: stepId(),
            type: "moderator_update",
            duration: 0,
            delay: T.ROUND_GAP,
            moderator: moderatorTextForRound(rn, "end"),
        });
    }

    // Final unfocus
    steps.push({
        id: stepId(),
        type: "unfocus_all",
        duration: 0,
        delay: 0,
    });

    return steps;
}

// ── Round 1: Agents form initial positions ──────────────────────────

function buildRound1Steps(
    messages: MessageDTO[],
    agents: AgentDTO[],
): AnimationStep[] {
    const steps: AnimationStep[] = [];

    // Group messages by agent for sequential agent reveal
    const agentMessages = new Map<string, MessageDTO>();
    for (const msg of messages) {
        if (msg.agent_id) {
            agentMessages.set(msg.agent_id, msg);
        }
    }

    // For agents without messages, still show them
    for (const agent of agents) {
        if (!agentMessages.has(agent.id)) {
            agentMessages.set(agent.id, null as unknown as MessageDTO);
        }
    }

    for (const [agentId] of agentMessages) {
        const nodeId = `agent-${agentId}`;
        const agent = agents.find((a) => a.id === agentId);
        const role = agent?.role ?? "Agent";

        // Enter the agent node
        steps.push({
            id: stepId(),
            type: "node_enter",
            targetId: nodeId,
            duration: T.NODE_ENTER,
            delay: 100,
            meta: { round: 1, description: `${capitalize(role)} enters the debate` },
        });

        // Focus on the agent
        steps.push({
            id: stepId(),
            type: "focus_node",
            targetId: nodeId,
            duration: T.FOCUS,
            delay: 100,
            meta: { round: 1, description: `Focus on ${capitalize(role)}` },
        });

        // Draw edge from question → agent
        steps.push({
            id: stepId(),
            type: "edge_draw",
            edge: {
                id: `edge-q-${agentId}-r1`,
                source: QUESTION_NODE_ID,
                target: nodeId,
                kind: "initial",
            },
            duration: T.EDGE_DRAW,
            delay: 100,
            meta: { round: 1, description: `Question reaches ${capitalize(role)}` },
        });

        // Activate agent
        steps.push({
            id: stepId(),
            type: "node_activate",
            targetId: nodeId,
            duration: T.NODE_ACTIVATE,
            delay: 200,
            meta: { round: 1, description: `${capitalize(role)} is forming their position` },
        });

        // Complete agent
        steps.push({
            id: stepId(),
            type: "node_complete",
            targetId: nodeId,
            duration: T.NODE_COMPLETE,
            delay: T.AGENT_GAP,
            meta: { round: 1, description: `${capitalize(role)} has stated their initial position` },
        });
    }

    // Unfocus after round
    steps.push({
        id: stepId(),
        type: "unfocus_all",
        duration: 0,
        delay: T.STEP_GAP,
    });

    return steps;
}

// ── Round 2: Agents critique each other (via intermediate nodes) ─────

function buildRound2Steps(
    messages: MessageDTO[],
    agents: AgentDTO[],
): AnimationStep[] {
    const steps: AnimationStep[] = [];
    const enteredIntermediates = new Set<string>();

    for (const msg of messages) {
        if (!msg.agent_id) continue;

        // Skip error payloads — don't infer debate edges from API failures
        if (isErrorPayload(msg.payload ?? {}) || isErrorText(msg.text)) continue;

        const agentId = msg.agent_id;
        const sourceNodeId = `agent-${agentId}`;
        const sourceIntermId = `${sourceNodeId}-r2`;
        const agent = agents.find((a) => a.id === agentId);
        const sourceRole = agent?.role ?? "Agent";

        // Enter source intermediate if not yet entered
        if (!enteredIntermediates.has(sourceIntermId)) {
            steps.push({
                id: stepId(),
                type: "node_enter",
                targetId: sourceIntermId,
                duration: T.NODE_ENTER,
                delay: 100,
                meta: { round: 2, description: `${capitalize(sourceRole)} enters the critique round` },
            });
            steps.push({
                id: stepId(),
                type: "edge_draw",
                edge: {
                    id: `edge-${agentId}-cont`,
                    source: sourceNodeId,
                    target: sourceIntermId,
                    kind: "initial",
                },
                duration: T.EDGE_DRAW,
                delay: 100,
                meta: { round: 2, description: `${capitalize(sourceRole)} advances to Round 2` },
            });
            enteredIntermediates.add(sourceIntermId);
        }

        const edgeKind = inferEdgeKindFromMessage(msg);
        const rawTargetNodeId = inferTargetFromMessage(msg, agents, sourceNodeId);
        const targetIntermId = `${rawTargetNodeId}-r2`;
        const targetAgentId = rawTargetNodeId.replace("agent-", "");
        const targetAgent = agents.find((a) => a.id === targetAgentId);
        const targetRole = targetAgent?.role ?? "Agent";
        const isCritique = edgeKind === "challenges";

        // Enter target intermediate if not yet entered
        if (!enteredIntermediates.has(targetIntermId)) {
            steps.push({
                id: stepId(),
                type: "node_enter",
                targetId: targetIntermId,
                duration: T.NODE_ENTER,
                delay: 100,
                meta: { round: 2, description: `${capitalize(targetRole)} enters the critique round` },
            });
            steps.push({
                id: stepId(),
                type: "edge_draw",
                edge: {
                    id: `edge-${targetAgentId}-cont`,
                    source: rawTargetNodeId,
                    target: targetIntermId,
                    kind: "initial",
                },
                duration: T.EDGE_DRAW,
                delay: 100,
                meta: { round: 2, description: `${capitalize(targetRole)} advances to Round 2` },
            });
            enteredIntermediates.add(targetIntermId);
        }

        const edgeId = `edge-${msg.id}`;

        // Focus source intermediate
        steps.push({
            id: stepId(),
            type: "focus_node",
            targetId: sourceIntermId,
            duration: T.FOCUS,
            delay: 100,
            meta: { round: 2, description: `Focus on ${capitalize(sourceRole)}` },
        });

        // Activate source
        steps.push({
            id: stepId(),
            type: "node_activate",
            targetId: sourceIntermId,
            duration: T.NODE_ACTIVATE,
            delay: 150,
            meta: { round: 2, description: `${capitalize(sourceRole)} is formulating a response` },
        });

        // Draw the cross-edge
        steps.push({
            id: stepId(),
            type: "edge_draw",
            edge: {
                id: edgeId,
                source: sourceIntermId,
                target: targetIntermId,
                kind: edgeKind,
            },
            duration: isCritique ? T.EDGE_DRAW_CRITIQUE : T.EDGE_DRAW,
            delay: 100,
            meta: {
                round: 2,
                description: isCritique
                    ? `${capitalize(sourceRole)} challenges ${capitalize(targetRole)}`
                    : `${capitalize(sourceRole)} supports ${capitalize(targetRole)}`,
            },
        });

        // Activate target (they're being addressed)
        steps.push({
            id: stepId(),
            type: "node_activate",
            targetId: targetIntermId,
            duration: T.NODE_ACTIVATE,
            delay: 200,
            meta: { round: 2, description: `${capitalize(targetRole)} receives the response` },
        });

        // Complete source
        steps.push({
            id: stepId(),
            type: "node_complete",
            targetId: sourceIntermId,
            duration: T.NODE_COMPLETE,
            delay: T.AGENT_GAP,
            meta: { round: 2, description: `${capitalize(sourceRole)} finished` },
        });
    }

    // Enter any remaining intermediates for agents without messages
    for (const agent of agents) {
        const intermId = `agent-${agent.id}-r2`;
        if (!enteredIntermediates.has(intermId)) {
            steps.push({
                id: stepId(),
                type: "node_enter",
                targetId: intermId,
                duration: T.NODE_ENTER,
                delay: 100,
                meta: { round: 2, description: `${capitalize(agent.role)} enters the critique round` },
            });
            steps.push({
                id: stepId(),
                type: "edge_draw",
                edge: {
                    id: `edge-${agent.id}-cont`,
                    source: `agent-${agent.id}`,
                    target: intermId,
                    kind: "initial",
                },
                duration: T.EDGE_DRAW,
                delay: 100,
                meta: { round: 2 },
            });
        }
    }

    // Complete all intermediates
    for (const agent of agents) {
        steps.push({
            id: stepId(),
            type: "node_complete",
            targetId: `agent-${agent.id}-r2`,
            duration: T.NODE_COMPLETE,
            delay: 50,
            meta: { round: 2 },
        });
    }

    steps.push({
        id: stepId(),
        type: "unfocus_all",
        duration: 0,
        delay: T.STEP_GAP,
    });

    return steps;
}

// ── Round 3: Synthesis convergence ──────────────────────────────────

function buildRound3Steps(
    messages: MessageDTO[],
    agents: AgentDTO[],
    _finalSummary: Record<string, unknown> | null,
): AnimationStep[] {
    const steps: AnimationStep[] = [];

    // Process any round 3 agent messages first
    for (const msg of messages) {
        if (!msg.agent_id) continue;
        const nodeId = `agent-${msg.agent_id}`;
        const agent = agents.find((a) => a.id === msg.agent_id);
        const role = agent?.role ?? "Agent";

        steps.push({
            id: stepId(),
            type: "node_activate",
            targetId: nodeId,
            duration: T.NODE_ACTIVATE,
            delay: 200,
            meta: { round: 3, description: `${capitalize(role)} contributes to synthesis` },
        });

        steps.push({
            id: stepId(),
            type: "node_complete",
            targetId: nodeId,
            duration: T.NODE_COMPLETE,
            delay: 100,
            meta: { round: 3 },
        });
    }

    // Enter synthesis node
    steps.push({
        id: stepId(),
        type: "node_enter",
        targetId: SYNTHESIS_NODE_ID,
        duration: T.NODE_ENTER + 200, // slower, dramatic
        delay: T.STEP_GAP,
        meta: { round: 3, description: "Synthesis is forming from all arguments" },
    });

    // Focus synthesis
    steps.push({
        id: stepId(),
        type: "focus_node",
        targetId: SYNTHESIS_NODE_ID,
        duration: T.FOCUS,
        delay: 200,
        meta: { round: 3, description: "Focus on the synthesis" },
    });

    // Draw edges from each agent's intermediate (or agent) to synthesis
    for (const agent of agents) {
        const intermId = `agent-${agent.id}-r2`;
        // Prefer intermediate node as source if it exists in the animation sequence
        const sourceId = intermId; // Will exist since round 2 creates them
        steps.push({
            id: stepId(),
            type: "edge_draw",
            edge: {
                id: `edge-${agent.id}-synth`,
                source: sourceId,
                target: SYNTHESIS_NODE_ID,
                kind: "summarizes",
            },
            duration: T.EDGE_DRAW,
            delay: 150,
            meta: { round: 3, description: `${capitalize(agent.role)}'s arguments feed into synthesis` },
        });
    }

    // Activate then complete synthesis
    steps.push({
        id: stepId(),
        type: "node_activate",
        targetId: SYNTHESIS_NODE_ID,
        duration: T.NODE_ACTIVATE,
        delay: T.STEP_GAP,
        meta: { round: 3, description: "Synthesis is being refined" },
    });

    steps.push({
        id: stepId(),
        type: "node_complete",
        targetId: SYNTHESIS_NODE_ID,
        duration: T.NODE_COMPLETE,
        delay: T.STEP_GAP,
        meta: { round: 3, description: "Synthesis complete — final position formed" },
    });

    // Final unfocus
    steps.push({
        id: stepId(),
        type: "unfocus_all",
        duration: 0,
        delay: 0,
    });

    return steps;
}

// ── Convert live WS events to animation steps ───────────────────────

export function wsEventToAnimationSteps(
    event: WsEvent,
    agents: AgentDTO[],
): AnimationStep[] {
    const steps: AnimationStep[] = [];

    switch (event.type) {
        case "turn_started":
            steps.push({
                id: stepId(),
                type: "moderator_update",
                duration: 0,
                delay: 0,
                moderator: {
                    status: "Live",
                    explanation: "The debate has begun. Agents are being activated.",
                },
            });
            break;

        case "round_started":
            steps.push({
                id: stepId(),
                type: "moderator_update",
                duration: 0,
                delay: T.STEP_GAP,
                moderator: moderatorTextForRound(event.round_number ?? 0, "start"),
            });

            if (event.round_number === 1) {
                // Enter the question node
                steps.push({
                    id: stepId(),
                    type: "node_enter",
                    targetId: QUESTION_NODE_ID,
                    duration: T.NODE_ENTER,
                    delay: T.STEP_GAP,
                    nodeData: {
                        id: QUESTION_NODE_ID,
                        kind: "question",
                        label: "Question",
                        round: 0,
                    },
                });
                steps.push({
                    id: stepId(),
                    type: "focus_node",
                    targetId: QUESTION_NODE_ID,
                    duration: T.FOCUS,
                    delay: T.ROUND_GAP,
                });
            }
            break;

        case "agent_started": {
            const nodeId = event.agent_id ? `agent-${event.agent_id}` : null;
            if (!nodeId) break;

            const rn = event.round_number ?? 1;
            const agentObj = agents.find((a) => a.id === event.agent_id);
            const role = agentObj?.role ?? "Agent";

            if (rn === 1) {
                // Agent appearing for the first time
                steps.push({
                    id: stepId(),
                    type: "node_enter",
                    targetId: nodeId,
                    duration: T.NODE_ENTER,
                    delay: 100,
                    meta: { round: 1, description: `${capitalize(role)} enters the debate` },
                    nodeData: {
                        id: nodeId,
                        kind: "agent",
                        label: role,
                        round: 1,
                        agentId: event.agent_id!,
                        agentRole: role,
                    },
                });
                steps.push({
                    id: stepId(),
                    type: "focus_node",
                    targetId: nodeId,
                    duration: T.FOCUS,
                    delay: 100,
                    meta: { round: 1, description: `Focus on ${capitalize(role)}` },
                });
                steps.push({
                    id: stepId(),
                    type: "edge_draw",
                    edge: {
                        id: `edge-q-${event.agent_id}-r1`,
                        source: QUESTION_NODE_ID,
                        target: nodeId,
                        kind: "initial",
                    },
                    duration: T.EDGE_DRAW,
                    delay: 100,
                    meta: { round: 1, description: `Question reaches ${capitalize(role)}` },
                });
            }

            if (rn === 2) {
                // Enter intermediate node for round 2
                const intermId = `${nodeId}-r2`;
                steps.push({
                    id: stepId(),
                    type: "node_enter",
                    targetId: intermId,
                    duration: T.NODE_ENTER,
                    delay: 100,
                    meta: { round: 2, description: `${capitalize(role)} enters the critique round` },
                    nodeData: {
                        id: intermId,
                        kind: "intermediate",
                        label: role,
                        round: 2,
                        agentId: event.agent_id!,
                        agentRole: role,
                    },
                });
                steps.push({
                    id: stepId(),
                    type: "edge_draw",
                    edge: {
                        id: `edge-${event.agent_id}-cont`,
                        source: nodeId,
                        target: intermId,
                        kind: "initial",
                    },
                    duration: T.EDGE_DRAW,
                    delay: 100,
                    meta: { round: 2, description: `${capitalize(role)} advances to Round 2` },
                });
                steps.push({
                    id: stepId(),
                    type: "node_activate",
                    targetId: intermId,
                    duration: T.NODE_ACTIVATE,
                    delay: 150,
                    meta: { round: 2, description: `${capitalize(role)} is formulating a critique` },
                });
                steps.push({
                    id: stepId(),
                    type: "focus_node",
                    targetId: intermId,
                    duration: T.FOCUS,
                    delay: 100,
                    meta: { round: 2 },
                });
            } else {
                steps.push({
                    id: stepId(),
                    type: "node_activate",
                    targetId: nodeId,
                    duration: T.NODE_ACTIVATE,
                    delay: 150,
                    meta: { round: rn, description: `${capitalize(role)} is thinking...` },
                });

                if (rn >= 3) {
                    steps.push({
                        id: stepId(),
                        type: "focus_node",
                        targetId: nodeId,
                        duration: T.FOCUS,
                        delay: 100,
                        meta: { round: rn },
                    });
                }
            }
            break;
        }

        case "message_created": {
            const agentId = event.agent_id;
            if (!agentId) break;

            // Skip error payloads — don't infer graph edges from API failures
            if (shouldSkipGraphInference(event.payload ?? {})) break;

            const sourceNodeId = `agent-${agentId}`;
            const rn = event.round_number ?? 1;
            const agentObj = agents.find((a) => a.id === agentId);
            const role = agentObj?.role ?? "Agent";

            if (rn === 2) {
                // Critique round: draw edge between intermediates
                const sourceIntermId = `${sourceNodeId}-r2`;
                const edgeKind = inferEdgeKindFromPayload(event.payload);
                const rawTargetNodeId = inferTargetFromPayload(
                    event.payload,
                    agents,
                    sourceNodeId,
                );
                const targetIntermId = `${rawTargetNodeId}-r2`;
                const targetAgentId = rawTargetNodeId.replace("agent-", "");
                const targetAgent = agents.find((a) => a.id === targetAgentId);
                const targetRole = targetAgent?.role ?? "Agent";
                const edgeId = `edge-wslive-${stepId()}`;
                const isCritique = edgeKind === "challenges";

                steps.push({
                    id: stepId(),
                    type: "edge_draw",
                    edge: {
                        id: edgeId,
                        source: sourceIntermId,
                        target: targetIntermId,
                        kind: edgeKind,
                    },
                    duration:
                        isCritique
                            ? T.EDGE_DRAW_CRITIQUE
                            : T.EDGE_DRAW,
                    delay: 100,
                    meta: {
                        round: 2,
                        description: isCritique
                            ? `${capitalize(role)} challenges ${capitalize(targetRole)}`
                            : `${capitalize(role)} supports ${capitalize(targetRole)}`,
                    },
                });

                steps.push({
                    id: stepId(),
                    type: "node_activate",
                    targetId: targetIntermId,
                    duration: T.NODE_ACTIVATE,
                    delay: T.STEP_GAP,
                    meta: { round: 2, description: `${capitalize(targetRole)} receives the response` },
                });
            }
            break;
        }

        case "agent_completed": {
            const nodeId = event.agent_id ? `agent-${event.agent_id}` : null;
            if (!nodeId) break;
            const rn = event.round_number ?? 1;

            // Complete the appropriate node (intermediate for round 2, agent otherwise)
            const targetNodeId = rn === 2 ? `${nodeId}-r2` : nodeId;
            steps.push({
                id: stepId(),
                type: "node_complete",
                targetId: targetNodeId,
                duration: T.NODE_COMPLETE,
                delay: T.STEP_GAP,
            });
            break;
        }

        case "round_completed": {
            const rn = event.round_number ?? 0;
            // Complete all agents
            for (const agent of agents) {
                steps.push({
                    id: stepId(),
                    type: "node_complete",
                    targetId: `agent-${agent.id}`,
                    duration: T.NODE_COMPLETE,
                    delay: 30,
                });
                // Also complete intermediates if round 2
                if (rn === 2) {
                    steps.push({
                        id: stepId(),
                        type: "node_complete",
                        targetId: `agent-${agent.id}-r2`,
                        duration: T.NODE_COMPLETE,
                        delay: 30,
                    });
                }
            }

            steps.push({
                id: stepId(),
                type: "unfocus_all",
                duration: 0,
                delay: T.STEP_GAP,
            });

            steps.push({
                id: stepId(),
                type: "moderator_update",
                duration: 0,
                delay: T.ROUND_GAP,
                moderator: moderatorTextForRound(rn, "end"),
            });

            // If round 2 ends, prepare for synthesis
            if (rn === 2) {
                steps.push({
                    id: stepId(),
                    type: "delay",
                    duration: T.ROUND_GAP,
                    delay: 0,
                });
            }
            break;
        }

        case "turn_completed":
            // If we don't have synthesis yet, add it
            steps.push({
                id: stepId(),
                type: "node_enter",
                targetId: SYNTHESIS_NODE_ID,
                duration: T.NODE_ENTER + 200,
                delay: T.STEP_GAP,
                meta: { round: 3, description: "Synthesis is forming from all arguments" },
                nodeData: {
                    id: SYNTHESIS_NODE_ID,
                    kind: "synthesis",
                    label: "Synthesis",
                    round: 3,
                },
            });
            steps.push({
                id: stepId(),
                type: "focus_node",
                targetId: SYNTHESIS_NODE_ID,
                duration: T.FOCUS,
                delay: 200,
                meta: { round: 3, description: "Focus on the synthesis" },
            });
            for (const agent of agents) {
                const intermId = `agent-${agent.id}-r2`;
                steps.push({
                    id: stepId(),
                    type: "edge_draw",
                    edge: {
                        id: `edge-${agent.id}-synth`,
                        source: intermId,
                        target: SYNTHESIS_NODE_ID,
                        kind: "summarizes",
                    },
                    duration: T.EDGE_DRAW,
                    delay: 150,
                    meta: { round: 3, description: `${capitalize(agent.role)}'s arguments feed into synthesis` },
                });
            }
            steps.push({
                id: stepId(),
                type: "node_activate",
                targetId: SYNTHESIS_NODE_ID,
                duration: T.NODE_ACTIVATE,
                delay: T.STEP_GAP,
                meta: { round: 3, description: "Synthesis is being refined" },
            });
            steps.push({
                id: stepId(),
                type: "node_complete",
                targetId: SYNTHESIS_NODE_ID,
                duration: T.NODE_COMPLETE,
                delay: T.STEP_GAP,
                meta: { round: 3, description: "Synthesis complete" },
            });
            steps.push({
                id: stepId(),
                type: "unfocus_all",
                duration: 0,
                delay: 0,
            });
            steps.push({
                id: stepId(),
                type: "moderator_update",
                duration: 0,
                delay: 0,
                moderator: {
                    status: "Completed",
                    explanation:
                        "The debate has concluded. Review the graph to explore all arguments and the final synthesis.",
                    watchFor: [],
                },
            });
            break;

        case "turn_failed":
            steps.push({
                id: stepId(),
                type: "moderator_update",
                duration: 0,
                delay: 0,
                moderator: {
                    status: "Failed",
                    explanation:
                        typeof event.payload?.["error"] === "string"
                            ? `Error: ${event.payload["error"]}`
                            : "The debate failed to complete.",
                },
            });
            break;
    }

    return steps;
}

// ── Helpers ──────────────────────────────────────────────────────────

function moderatorTextForRound(
    rn: number,
    phase: "start" | "end",
): AnimationStep["moderator"] {
    if (phase === "start") {
        switch (rn) {
            case 1:
                return {
                    status: "Round 1",
                    explanation:
                        "Agents are forming their initial perspectives on the question. Watch as each agent develops their stance.",
                    watchFor: [
                        "Agent nodes appearing on the graph",
                        "Initial positions being stated",
                    ],
                };
            case 2:
                return {
                    status: "Round 2",
                    explanation:
                        "Agents are engaging with each other's arguments. This is where the real debate happens — watch for challenges and support.",
                    watchFor: [
                        "Challenge edges (pink, dashed)",
                        "Support edges (green, solid)",
                        "Shifting perspectives",
                    ],
                };
            case 3:
                return {
                    status: "Round 3",
                    explanation:
                        "The debate is converging. A synthesis of the strongest arguments is being formed.",
                    watchFor: [
                        "Synthesis node appearing",
                        "Final convergence of ideas",
                    ],
                };
            default:
                return { status: `Round ${rn}`, explanation: "Processing..." };
        }
    } else {
        return {
            explanation:
                rn < 3
                    ? `Round ${rn} complete. Preparing next round...`
                    : "All rounds complete. Finalizing synthesis...",
        };
    }
}

function inferEdgeKindFromMessage(msg: MessageDTO): string {
    if (msg.message_type === "critique") return "challenges";
    const text = msg.text?.toLowerCase() ?? "";
    if (
        text.includes("disagree") ||
        text.includes("however") ||
        text.includes("flaw")
    )
        return "challenges";
    if (
        text.includes("agree") ||
        text.includes("support") ||
        text.includes("build")
    )
        return "supports";
    return "supports";
}

function inferEdgeKindFromPayload(payload: Record<string, unknown>): string {
    const msgType = payload?.["message_type"] as string | undefined;
    if (msgType === "critique") return "challenges";
    const text =
        ((payload?.["text"] as string) ?? "").toLowerCase() +
        ((payload?.["position"] as string) ?? "").toLowerCase();
    if (
        text.includes("disagree") ||
        text.includes("however") ||
        text.includes("flaw") ||
        text.includes("critique")
    )
        return "challenges";
    if (
        text.includes("agree") ||
        text.includes("support") ||
        text.includes("build")
    )
        return "supports";
    return "supports";
}

function inferTargetFromMessage(
    msg: MessageDTO,
    agents: AgentDTO[],
    sourceNodeId: string,
): string {
    const p = msg.payload ?? {};
    return inferTargetFromPayloadInner(p, agents, sourceNodeId);
}

function inferTargetFromPayload(
    payload: Record<string, unknown>,
    agents: AgentDTO[],
    sourceNodeId: string,
): string {
    return inferTargetFromPayloadInner(payload, agents, sourceNodeId);
}

function inferTargetFromPayloadInner(
    payload: Record<string, unknown>,
    agents: AgentDTO[],
    sourceNodeId: string,
): string {
    if (typeof payload["target_agent"] === "string") {
        const target = agents.find(
            (a) =>
                a.id === payload["target_agent"] ||
                a.role === payload["target_agent"],
        );
        if (target) return `agent-${target.id}`;
    }

    if (Array.isArray(payload["references"])) {
        const refs = payload["references"] as string[];
        const refAgent = agents.find(
            (a) => refs.includes(a.id) || refs.includes(a.role),
        );
        if (refAgent) return `agent-${refAgent.id}`;
    }

    // Fallback: pick a different agent
    const others = agents.filter((a) => `agent-${a.id}` !== sourceNodeId);
    if (others.length > 0) {
        const idx = Math.floor(Math.random() * others.length);
        return `agent-${others[idx].id}`;
    }
    return QUESTION_NODE_ID;
}

function capitalize(s: string): string {
    if (!s) return "Agent";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
