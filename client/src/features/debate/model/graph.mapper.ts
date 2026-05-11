/**
 * Graph Mapper — converts backend DTOs into frontend graph model.
 *
 * Heuristics documented:
 * - Round 1 messages → question→agent edges (kind: "initial")
 * - Round 2 messages → agent-to-agent edges inferred from message_type:
 *   - "critique" → "challenges" edge pointing at the critiqued agent
 *   - otherwise → "supports" edge (default assumption when relationships are unspecified)
 * - Round 3 "final_summary" → synthesis node + "summarizes" edges from agents
 * - If payload contains "target_agent" or "references", use those to link edges
 * - Fallback: if no structural info, default to support
 */

import type {
    AgentDTO,
    MessageDTO,
    RoundDTO,
    SessionDetailDTO,
    WsEvent,
} from "../api/debate.types";
import { isErrorPayload, isErrorText, shouldSkipGraphInference, normalizeAgentError, formatModeratorError } from "./error-normalizer";
import {
    extractFullResponse,
    formatModeratorEvent,
    formatRound1Summary,
    formatRound2Summary,
    formatFinalSummary,
    getTurnSummary,
    normalizeSummary,
} from "./formatters";
import type {
    ActivityItem,
    DebateGraph,
    DebateGraphEdge,
    DebateGraphNode,
    GraphEdgeKind,
    GraphNodeStatus,
    ModeratorState,
    TimelineRound,
} from "./graph.types";

// ── Constants ────────────────────────────────────────────────────────

const QUESTION_NODE_ID = "question-node";
const SYNTHESIS_NODE_ID = "synthesis-node";

// ── Helper: parse message payload safely ─────────────────────────────

function safePayload(msg: MessageDTO): Record<string, unknown> {
    try {
        if (msg.payload && typeof msg.payload === "object") return msg.payload;
        return {};
    } catch {
        return {};
    }
}

/**
 * Find a `final_summary` message in the round and return its payload as a
 * dict matching the shape used by `addSynthesisNode` / `addUpdatedSynthesisNode`.
 * Mirrors the backend's serializer logic (which scans for the most recent
 * `final_summary` message), but scoped to a specific round so the original
 * cycle-1 synthesis can be recovered even after follow-up cycles overwrite
 * `turn.final_summary` at the turn level.
 */
function extractFinalSummaryPayload(round: RoundDTO): Record<string, unknown> | null {
    // Iterate from the last message backward to match backend semantics.
    for (let i = round.messages.length - 1; i >= 0; i--) {
        const msg = round.messages[i];
        if (msg.message_type !== "final_summary") continue;
        const payload = safePayload(msg);
        if (Object.keys(payload).length > 0) return payload;
        // Fall back to plain text when payload is empty.
        if (msg.text) return { summary: msg.text };
    }
    return null;
}

function extractContent(msg: MessageDTO): string {
    const p = safePayload(msg);
    if (typeof p["display_content"] === "string" && String(p["display_content"]).trim()) {
        return extractFullResponse(String(p["display_content"]));
    }
    if (typeof p["response"] === "string") return extractFullResponse(String(p["response"]));
    if (typeof p["reasoning"] === "string") return extractFullResponse(String(p["reasoning"]));
    if (typeof p["text"] === "string") return extractFullResponse(String(p["text"]));
    // Fall back to the first available string field in payload
    for (const val of Object.values(p)) {
        if (typeof val === "string" && val.length > 0) return extractFullResponse(val);
    }
    return extractFullResponse(msg.text ?? "");
}

function extractRawOutput(msg: MessageDTO): string {
    const p = safePayload(msg);
    if (typeof p["raw_content"] === "string") return String(p["raw_content"]);
    return msg.text ?? "";
}

function isFallbackPayload(msg: MessageDTO): boolean {
    return safePayload(msg)["is_fallback"] === true;
}

// ── Map full session to initial graph ────────────────────────────────

export function mapSessionToGraph(session: SessionDetailDTO): DebateGraph {
    const nodes: DebateGraphNode[] = [];
    const edges: DebateGraphEdge[] = [];

    // Question node
    nodes.push({
        id: QUESTION_NODE_ID,
        kind: "question",
        label: session.question || session.title || "Question",
        round: 0,
        status: "visible",
        content: session.question,
    });

    // Agent nodes
    const agents = session.agents ?? [];
    // Count session-shared documents (used for the "shared_session_docs" badge).
    const sessionDocCount = (session as unknown as { documents?: unknown[] }).documents?.length ?? 0;
    agents.forEach((agent) => {
        const mode = agent.knowledge_mode ?? "shared_session_docs";
        let docCount = 0;
        if (mode === "assigned_docs_only") {
            docCount = agent.document_ids?.length ?? 0;
        } else if (mode === "shared_session_docs") {
            docCount = sessionDocCount;
        }
        nodes.push({
            id: `agent-${agent.id}`,
            kind: "agent",
            label: agent.role,
            round: 0,
            status: "hidden",
            agentId: agent.id,
            agentRole: agent.role,
            knowledge: { mode, docCount },
        });
    });

    // Process rounds
    const turn = session.latest_turn;
    if (turn) {
        // Map cycle_number → user follow-up question for quick lookup
        const followUpsByCycle = new Map<number, string>();
        for (const fu of turn.follow_ups ?? []) {
            followUpsByCycle.set(fu.cycle_number, fu.question);
        }

        for (const round of turn.rounds) {
            const cycle = round.cycle_number ?? 1;
            if (cycle >= 2) {
                const fuQuestion = followUpsByCycle.get(cycle) ?? "";
                applyFollowUpRoundToGraph(nodes, edges, round, agents, cycle, fuQuestion);
            } else {
                applyRoundToGraph(nodes, edges, round, agents);
            }
        }

        // Final summary → synthesis node(s)
        //
        // The backend's `turn.final_summary` is sourced from the most recent
        // `final_summary` message across all rounds, so when a follow-up cycle
        // runs an `updated_synthesis`, that payload overwrites the original
        // cycle-1 synthesis at the turn level. To keep the original synthesis
        // node visible after a reload, we extract the cycle-1 synthesis
        // directly from the cycle-1 `final` round messages, and treat
        // `turn.final_summary` as the (possibly newer) follow-up synthesis.
        const cycle1FinalRound = turn.rounds.find(
            (r) => (r.cycle_number ?? 1) === 1 && r.round_type === "final",
        );
        const cycle1Synthesis = cycle1FinalRound
            ? extractFinalSummaryPayload(cycle1FinalRound)
            : null;
        if (cycle1Synthesis) {
            addSynthesisNode(nodes, edges, cycle1Synthesis, agents);
        } else if (turn.final_summary) {
            // No cycle-1 final messages were found (very old data); fall back to
            // turn-level final_summary so the synthesis node still appears when
            // there are no follow-ups.
            const lastRound = turn.rounds[turn.rounds.length - 1];
            if (!lastRound || lastRound.round_type !== "updated_synthesis") {
                addSynthesisNode(nodes, edges, turn.final_summary, agents);
            }
        }

        // Render the latest follow-up synthesis on top of the original one
        // when the turn ended with an `updated_synthesis` round.
        const lastRound = turn.rounds[turn.rounds.length - 1];
        if (
            lastRound &&
            lastRound.round_type === "updated_synthesis" &&
            turn.final_summary
        ) {
            addUpdatedSynthesisNode(
                nodes,
                edges,
                turn.final_summary,
                agents,
                lastRound.cycle_number ?? 2,
            );
        }
    }

    return { nodes, edges };
}

// ── Apply one round to graph ─────────────────────────────────────────

function applyRoundToGraph(
    nodes: DebateGraphNode[],
    edges: DebateGraphEdge[],
    round: RoundDTO,
    agents: AgentDTO[],
): void {
    const rn = round.round_number;
    const isCompleted = round.status === "completed";
    const isRunning = round.status === "running";

    for (const msg of round.messages) {
        const agentNodeId = msg.agent_id ? `agent-${msg.agent_id}` : null;
        const agentNode = agentNodeId
            ? nodes.find((n) => n.id === agentNodeId)
            : null;

        if (agentNode) {
            // Reveal / activate agent node
            if (isCompleted) {
                agentNode.status = "completed";
            } else if (isRunning) {
                agentNode.status = "active";
            } else {
                agentNode.status = "visible";
            }

            // Attach summary from latest message (round-aware)
            if (rn === 1) {
                agentNode.summary = formatRound1Summary(msg.text);
            } else if (rn !== 2) {
                // Round 2 is handled by intermediate nodes; round 3 by synthesis
                agentNode.summary = getTurnSummary({
                    raw: msg.text,
                    round: rn,
                    kind: agentNode.kind,
                    sourceRole: agentNode.agentRole,
                });
            }
            agentNode.content = extractContent(msg);
            agentNode.metadata = {
                ...(agentNode.metadata ?? {}),
                rawOutput: extractRawOutput(msg),
                isFallback: isFallbackPayload(msg),
            };
            agentNode.round = rn;
        }

        if (rn === 1 && agentNodeId) {
            // Round 1: question → agent
            const edgeId = `edge-q-${msg.agent_id}-r1`;
            if (!edges.find((e) => e.id === edgeId)) {
                edges.push({
                    id: edgeId,
                    source: QUESTION_NODE_ID,
                    target: agentNodeId,
                    kind: "initial",
                    round: 1,
                    status: isCompleted ? "completed" : "active",
                });
            }
        } else if (rn === 2 && agentNodeId) {
            // Skip error payloads — don't create misleading edges from error text
            if (isErrorPayload(msg.payload ?? {}) || isErrorText(msg.text)) continue;

            // Round 2: create intermediate nodes and cross-edges between them
            const agentId = msg.agent_id!;
            const intermNodeId = `${agentNodeId}-r2`;

            // Determine target early so we can use it in the summary
            const edgeKind = inferEdgeKind(msg);
            const rawTargetId = inferTarget(msg, agents, agentNodeId);
            const targetAgentForSummary = nodes.find((n) => n.id === rawTargetId);

            // Create intermediate node for source agent if not yet present
            if (!nodes.find((n) => n.id === intermNodeId)) {
                const parentNode = nodes.find((n) => n.id === agentNodeId);
                nodes.push({
                    id: intermNodeId,
                    kind: "intermediate",
                    label: parentNode?.agentRole ?? "Agent",
                    round: 2,
                    status: isCompleted ? "completed" : isRunning ? "active" : "visible",
                    agentId: agentId,
                    agentRole: parentNode?.agentRole,
                    summary: formatRound2Summary(msg.text, parentNode?.agentRole, targetAgentForSummary?.agentRole),
                    content: extractContent(msg),
                    metadata: { rawOutput: extractRawOutput(msg), isFallback: isFallbackPayload(msg) },
                });

                // Continuation edge from agent to intermediate
                const contEdgeId = `edge-${agentId}-cont`;
                if (!edges.find((e) => e.id === contEdgeId)) {
                    edges.push({
                        id: contEdgeId,
                        source: agentNodeId,
                        target: intermNodeId,
                        kind: "initial",
                        round: 2,
                        status: isCompleted ? "completed" : "active",
                    });
                }
            } else {
                // Update existing intermediate node content
                const intermNode = nodes.find((n) => n.id === intermNodeId)!;
                intermNode.summary = formatRound2Summary(msg.text, intermNode.agentRole, targetAgentForSummary?.agentRole);
                intermNode.content = extractContent(msg);
                intermNode.metadata = {
                    ...(intermNode.metadata ?? {}),
                    rawOutput: extractRawOutput(msg),
                    isFallback: isFallbackPayload(msg),
                };
                if (isCompleted) intermNode.status = "completed";
                else if (isRunning) intermNode.status = "active";
            }

            // Create cross-edge between intermediates
            const targetIntermId = `${rawTargetId}-r2`;

            // Ensure target intermediate exists
            if (!nodes.find((n) => n.id === targetIntermId)) {
                const targetAgentNode = nodes.find((n) => n.id === rawTargetId);
                nodes.push({
                    id: targetIntermId,
                    kind: "intermediate",
                    label: targetAgentNode?.agentRole ?? "Agent",
                    round: 2,
                    status: isCompleted ? "completed" : "visible",
                    agentId: targetAgentNode?.agentId,
                    agentRole: targetAgentNode?.agentRole,
                });

                // Continuation edge for target
                const contEdgeId2 = `edge-${targetAgentNode?.agentId}-cont`;
                if (!edges.find((e) => e.id === contEdgeId2)) {
                    edges.push({
                        id: contEdgeId2,
                        source: rawTargetId,
                        target: targetIntermId,
                        kind: "initial",
                        round: 2,
                        status: isCompleted ? "completed" : "active",
                    });
                }
            }

            const edgeId = `edge-${msg.id}`;
            if (!edges.find((e) => e.id === edgeId)) {
                const edgeLabels: Record<string, string> = {
                    challenges: "challenges",
                    supports: "supports",
                    questions: "questions",
                };
                edges.push({
                    id: edgeId,
                    source: intermNodeId,
                    target: targetIntermId,
                    kind: edgeKind,
                    round: 2,
                    status: isCompleted ? "completed" : "active",
                    label: edgeLabels[edgeKind],
                });
            }
        } else if (rn === 3 && msg.message_type === "final_summary") {
            // Handled by addSynthesisNode
        } else if (rn === 3 && agentNodeId) {
            // Round 3 agent messages → link to synthesis (from intermediate if exists)
            const intermNodeId = `${agentNodeId}-r2`;
            const sourceId = nodes.find((n) => n.id === intermNodeId) ? intermNodeId : agentNodeId;
            const edgeId = `edge-${msg.agent_id}-synth`;
            if (!edges.find((e) => e.id === edgeId)) {
                edges.push({
                    id: edgeId,
                    source: sourceId,
                    target: SYNTHESIS_NODE_ID,
                    kind: "summarizes",
                    round: 3,
                    status: isCompleted ? "completed" : "active",
                });
            }
        }
    }
}

// ── Add synthesis node ───────────────────────────────────────────────

function addSynthesisNode(
    nodes: DebateGraphNode[],
    edges: DebateGraphEdge[],
    summary: Record<string, unknown>,
    agents: AgentDTO[],
): void {
    const existing = nodes.find((n) => n.id === SYNTHESIS_NODE_ID);
    const rawJson = JSON.stringify(summary);
    const rawText =
        typeof summary["summary"] === "string"
            ? (summary["summary"] as string)
            : typeof summary["text"] === "string"
                ? (summary["text"] as string)
                : rawJson;
    const summaryText = formatFinalSummary(rawText);

    if (!existing) {
        nodes.push({
            id: SYNTHESIS_NODE_ID,
            kind: "synthesis",
            label: "Synthesis",
            round: 3,
            status: "completed",
            summary: summaryText,
            content: normalizeSummary("", rawText, 260),
            metadata: { rawOutput: rawJson, isFallback: summary["is_fallback"] === true },
        });
    } else {
        existing.summary = summaryText;
        existing.content = normalizeSummary("", rawText, 260);
        existing.metadata = {
            ...(existing.metadata ?? {}),
            rawOutput: rawJson,
            isFallback: summary["is_fallback"] === true,
        };
        existing.status = "completed";
    }

    // Ensure edges from agents → synthesis (prefer intermediate nodes if they exist)
    for (const agent of agents) {
        const intermId = `agent-${agent.id}-r2`;
        const sourceId = nodes.find((n) => n.id === intermId) ? intermId : `agent-${agent.id}`;
        const edgeId = `edge-${agent.id}-synth`;
        if (!edges.find((e) => e.id === edgeId)) {
            edges.push({
                id: edgeId,
                source: sourceId,
                target: SYNTHESIS_NODE_ID,
                kind: "summarizes",
                round: 3,
                status: "completed",
            });
        }
    }
}

// ── Follow-up cycle node IDs ─────────────────────────────────────────

function followUpQuestionId(cycle: number) {
    return `followup-question-c${cycle}`;
}
function followUpAgentId(agentId: string, cycle: number) {
    return `followup-agent-${agentId}-c${cycle}`;
}
function followUpCritiqueId(agentId: string, cycle: number) {
    return `followup-critique-${agentId}-c${cycle}`;
}
function followUpSynthesisId(cycle: number) {
    return `followup-synthesis-c${cycle}`;
}

// ── Apply one follow-up cycle round to graph (cycle ≥ 2) ─────────────

function applyFollowUpRoundToGraph(
    nodes: DebateGraphNode[],
    edges: DebateGraphEdge[],
    round: RoundDTO,
    agents: AgentDTO[],
    cycle: number,
    followUpQuestion: string,
): void {
    const isCompleted = round.status === "completed";
    const isRunning = round.status === "running";
    const status: GraphNodeStatus = isCompleted ? "completed" : isRunning ? "active" : "visible";
    const edgeStatus = isCompleted ? "completed" : "active";
    const rn = round.round_number;
    const rtype = round.round_type;

    // 1) Ensure follow-up question node exists once per cycle
    const fuqId = followUpQuestionId(cycle);
    if (!nodes.find((n) => n.id === fuqId)) {
        nodes.push({
            id: fuqId,
            kind: "followup-question",
            label: `Follow-up #${cycle - 1}`,
            round: rn,
            cycle,
            status: "visible",
            content: followUpQuestion,
            summary: followUpQuestion,
        });

        // Connect previous synthesis (initial or prior follow-up) to this question
        const prevSynthId =
            cycle === 2
                ? SYNTHESIS_NODE_ID
                : followUpSynthesisId(cycle - 1);
        if (nodes.find((n) => n.id === prevSynthId)) {
            const eid = `edge-${prevSynthId}-${fuqId}`;
            if (!edges.find((e) => e.id === eid)) {
                edges.push({
                    id: eid,
                    source: prevSynthId,
                    target: fuqId,
                    kind: "initial",
                    round: rn,
                    status: "completed",
                });
            }
        }
    }

    if (rtype === "followup_response") {
        // Each agent answers — create a per-agent response node
        for (const msg of round.messages) {
            if (!msg.agent_id) continue;
            if (isErrorPayload(msg.payload ?? {}) || isErrorText(msg.text)) continue;

            const agentRole =
                msg.agent_role ??
                agents.find((a) => a.id === msg.agent_id)?.role ??
                "Agent";
            const nid = followUpAgentId(msg.agent_id, cycle);

            const summaryText = getTurnSummary({
                raw: msg.text,
                round: rn,
                kind: "followup-agent",
                sourceRole: agentRole,
            });

            const existing = nodes.find((n) => n.id === nid);
            if (existing) {
                existing.status = status;
                existing.summary = summaryText;
                existing.content = extractContent(msg);
                existing.metadata = {
                    ...(existing.metadata ?? {}),
                    rawOutput: extractRawOutput(msg),
                    isFallback: isFallbackPayload(msg),
                };
            } else {
                nodes.push({
                    id: nid,
                    kind: "followup-agent",
                    label: agentRole,
                    round: rn,
                    cycle,
                    status,
                    agentId: msg.agent_id,
                    agentRole,
                    summary: summaryText,
                    content: extractContent(msg),
                    metadata: {
                        rawOutput: extractRawOutput(msg),
                        isFallback: isFallbackPayload(msg),
                    },
                });
            }

            // Edge: question → response
            const eid = `edge-${fuqId}-${nid}`;
            if (!edges.find((e) => e.id === eid)) {
                edges.push({
                    id: eid,
                    source: fuqId,
                    target: nid,
                    kind: "initial",
                    round: rn,
                    status: edgeStatus,
                });
            }
        }
    } else if (rtype === "followup_critique") {
        for (const msg of round.messages) {
            if (!msg.agent_id) continue;
            if (isErrorPayload(msg.payload ?? {}) || isErrorText(msg.text)) continue;

            const agentRole =
                msg.agent_role ??
                agents.find((a) => a.id === msg.agent_id)?.role ??
                "Agent";
            const nid = followUpCritiqueId(msg.agent_id, cycle);
            const sourceResponseId = followUpAgentId(msg.agent_id, cycle);

            const existing = nodes.find((n) => n.id === nid);
            if (!existing) {
                nodes.push({
                    id: nid,
                    kind: "followup-intermediate",
                    label: agentRole,
                    round: rn,
                    cycle,
                    status,
                    agentId: msg.agent_id,
                    agentRole,
                    summary: formatRound2Summary(msg.text, agentRole),
                    content: extractContent(msg),
                    metadata: {
                        rawOutput: extractRawOutput(msg),
                        isFallback: isFallbackPayload(msg),
                    },
                });
            } else {
                existing.status = status;
                existing.summary = formatRound2Summary(msg.text, agentRole);
                existing.content = extractContent(msg);
                existing.metadata = {
                    ...(existing.metadata ?? {}),
                    rawOutput: extractRawOutput(msg),
                    isFallback: isFallbackPayload(msg),
                };
            }

            // Edge: response → critique (continuation)
            if (nodes.find((n) => n.id === sourceResponseId)) {
                const contEid = `edge-${sourceResponseId}-${nid}`;
                if (!edges.find((e) => e.id === contEid)) {
                    edges.push({
                        id: contEid,
                        source: sourceResponseId,
                        target: nid,
                        kind: "initial",
                        round: rn,
                        status: edgeStatus,
                    });
                }
            }

            // Cross-edge to peer's response (challenges)
            const targetRawId = inferTarget(msg, agents, `agent-${msg.agent_id}`);
            const targetAgentId = targetRawId.startsWith("agent-")
                ? targetRawId.slice("agent-".length)
                : null;
            if (targetAgentId) {
                const targetCritiqueId = followUpCritiqueId(targetAgentId, cycle);
                if (nodes.find((n) => n.id === targetCritiqueId)) {
                    const xid = `edge-${msg.id}`;
                    if (!edges.find((e) => e.id === xid)) {
                        edges.push({
                            id: xid,
                            source: nid,
                            target: targetCritiqueId,
                            kind: "challenges",
                            round: rn,
                            status: edgeStatus,
                            label: "challenges",
                        });
                    }
                }
            }
        }
    } else if (rtype === "updated_synthesis") {
        // Updated synthesis is finalized via addUpdatedSynthesisNode using turn.final_summary.
        // Pre-create a placeholder synthesis node so layout can include it while running.
        const sid = followUpSynthesisId(cycle);
        if (!nodes.find((n) => n.id === sid)) {
            nodes.push({
                id: sid,
                kind: "followup-synthesis",
                label: `Updated Synthesis #${cycle - 1}`,
                round: rn,
                cycle,
                status,
            });
        } else {
            const node = nodes.find((n) => n.id === sid)!;
            node.status = status;
        }

        // Edges: each agent's critique → updated synthesis
        for (const agent of agents) {
            const critId = followUpCritiqueId(agent.id, cycle);
            const respId = followUpAgentId(agent.id, cycle);
            const sourceId = nodes.find((n) => n.id === critId)
                ? critId
                : nodes.find((n) => n.id === respId)
                    ? respId
                    : null;
            if (!sourceId) continue;
            const eid = `edge-${sourceId}-${sid}`;
            if (!edges.find((e) => e.id === eid)) {
                edges.push({
                    id: eid,
                    source: sourceId,
                    target: sid,
                    kind: "summarizes",
                    round: rn,
                    status: edgeStatus,
                });
            }
        }
    }
}

// ── Updated synthesis node (cycle ≥ 2) ───────────────────────────────

function addUpdatedSynthesisNode(
    nodes: DebateGraphNode[],
    edges: DebateGraphEdge[],
    summary: Record<string, unknown>,
    agents: AgentDTO[],
    cycle: number,
): void {
    const sid = followUpSynthesisId(cycle);
    const rawJson = JSON.stringify(summary);
    const rawText =
        typeof summary["full_answer"] === "string"
            ? (summary["full_answer"] as string)
            : typeof summary["quick_takeaway"] === "string"
                ? (summary["quick_takeaway"] as string)
                : typeof summary["summary"] === "string"
                    ? (summary["summary"] as string)
                    : rawJson;
    const summaryText = formatFinalSummary(rawText);

    const existing = nodes.find((n) => n.id === sid);
    if (!existing) {
        nodes.push({
            id: sid,
            kind: "followup-synthesis",
            label: `Updated Synthesis #${cycle - 1}`,
            round: 0,
            cycle,
            status: "completed",
            summary: summaryText,
            content: normalizeSummary("", rawText, 260),
            metadata: { rawOutput: rawJson, isFallback: summary["is_fallback"] === true },
        });
    } else {
        existing.summary = summaryText;
        existing.content = normalizeSummary("", rawText, 260);
        existing.metadata = {
            ...(existing.metadata ?? {}),
            rawOutput: rawJson,
            isFallback: summary["is_fallback"] === true,
        };
        existing.status = "completed";
    }

    for (const agent of agents) {
        const critId = followUpCritiqueId(agent.id, cycle);
        const respId = followUpAgentId(agent.id, cycle);
        const sourceId = nodes.find((n) => n.id === critId)
            ? critId
            : nodes.find((n) => n.id === respId)
                ? respId
                : null;
        if (!sourceId) continue;
        const eid = `edge-${sourceId}-${sid}`;
        if (!edges.find((e) => e.id === eid)) {
            edges.push({
                id: eid,
                source: sourceId,
                target: sid,
                kind: "summarizes",
                round: 0,
                status: "completed",
            });
        }
    }
}

// ── Heuristic: infer edge kind from message ──────────────────────────

function inferEdgeKind(msg: MessageDTO): GraphEdgeKind {
    if (msg.message_type === "critique") return "challenges";

    const p = safePayload(msg);
    const stance = (p["stance"] as string)?.toLowerCase?.() ?? "";
    if (stance.includes("challenge") || stance.includes("disagree") || stance.includes("critic"))
        return "challenges";
    if (stance.includes("support") || stance.includes("agree"))
        return "supports";
    if (stance.includes("question") || stance.includes("inquir"))
        return "questions";

    // Check content for keywords
    const text = msg.text?.toLowerCase() ?? "";
    if (
        text.includes("disagree") ||
        text.includes("however") ||
        text.includes("problematic") ||
        text.includes("flaw")
    )
        return "challenges";
    if (
        text.includes("agree") ||
        text.includes("supports") ||
        text.includes("builds on") ||
        text.includes("reinforce")
    )
        return "supports";

    return "supports"; // default fallback
}

// ── Heuristic: infer target of an edge ───────────────────────────────

function inferTarget(
    msg: MessageDTO,
    agents: AgentDTO[],
    sourceNodeId: string,
): string {
    const p = safePayload(msg);

    // Check if payload has explicit target
    if (typeof p["target_agent"] === "string") {
        const target = agents.find(
            (a) => a.id === p["target_agent"] || a.role === p["target_agent"],
        );
        if (target) return `agent-${target.id}`;
    }

    // Check references array
    if (Array.isArray(p["references"])) {
        const refs = p["references"] as string[];
        const refAgent = agents.find(
            (a) => refs.includes(a.id) || refs.includes(a.role),
        );
        if (refAgent) return `agent-${refAgent.id}`;
    }

    // Fallback: link to a different agent (round-robin)
    const otherAgents = agents.filter((a) => `agent-${a.id}` !== sourceNodeId);
    if (otherAgents.length > 0) {
        // Pick agent based on message sequence for variety
        const idx = msg.sequence_no % otherAgents.length;
        return `agent-${otherAgents[idx].id}`;
    }

    // Last resort: link back to question
    return QUESTION_NODE_ID;
}

// ── Apply a single WS event to existing graph ───────────────────────

export function applyWsEventToGraph(
    graph: DebateGraph,
    event: WsEvent,
    agents: AgentDTO[],
): DebateGraph {
    const nodes = [...graph.nodes];
    const edges = [...graph.edges];

    switch (event.type) {
        case "round_started": {
            const rn = event.round_number ?? 0;
            // Activate agent nodes
            nodes.forEach((n) => {
                if (n.kind === "agent" && n.status === "hidden") {
                    n.status = "visible";
                }
            });
            if (rn === 2) {
                // Pre-create intermediate nodes for round 2
                for (const agent of agents) {
                    const intermId = `agent-${agent.id}-r2`;
                    if (!nodes.find((n) => n.id === intermId)) {
                        nodes.push({
                            id: intermId,
                            kind: "intermediate",
                            label: agent.role,
                            round: 2,
                            status: "hidden",
                            agentId: agent.id,
                            agentRole: agent.role,
                        });
                        // Continuation edge (hidden, will be drawn by animation)
                        const contEdgeId = `edge-${agent.id}-cont`;
                        if (!edges.find((e) => e.id === contEdgeId)) {
                            edges.push({
                                id: contEdgeId,
                                source: `agent-${agent.id}`,
                                target: intermId,
                                kind: "initial",
                                round: 2,
                                status: "hidden",
                            });
                        }
                    }
                }
            }
            if (rn === 3) {
                // Pre-create synthesis node as hidden
                if (!nodes.find((n) => n.id === SYNTHESIS_NODE_ID)) {
                    nodes.push({
                        id: SYNTHESIS_NODE_ID,
                        kind: "synthesis",
                        label: "Synthesis",
                        round: 3,
                        status: "hidden",
                    });
                }
            }
            break;
        }

        case "agent_started": {
            if (event.agent_id) {
                const nodeId = `agent-${event.agent_id}`;
                const node = nodes.find((n) => n.id === nodeId);
                if (node) node.status = "active";
            }
            break;
        }

        case "message_created": {
            const payload = event.payload;
            const agentId = event.agent_id;
            const rn = event.round_number ?? 1;

            // Skip graph inference for error payloads
            if (shouldSkipGraphInference(payload ?? {})) break;

            if (agentId) {
                const nodeId = `agent-${agentId}`;
                const node = nodes.find((n) => n.id === nodeId);
                if (node) {
                    node.status = "active";
                    if (typeof payload["content"] === "string") {
                        const raw = payload["content"] as string;
                        node.summary = getTurnSummary({
                            raw,
                            round: rn,
                            kind: node.kind,
                            sourceRole: node.agentRole,
                        });
                        node.content = raw;
                    }
                    node.round = rn;
                    if (payload["retrieval"] && typeof payload["retrieval"] === "object") {
                        node.metadata = { ...(node.metadata ?? {}), retrieval: payload["retrieval"] };
                    }
                }

                if (rn === 1) {
                    const edgeId = `edge-q-${agentId}-r1`;
                    if (!edges.find((e) => e.id === edgeId)) {
                        edges.push({
                            id: edgeId,
                            source: QUESTION_NODE_ID,
                            target: nodeId,
                            kind: "initial",
                            round: 1,
                            status: "active",
                        });
                    }
                } else if (rn === 2) {
                    // Round 2: use intermediate nodes
                    const intermNodeId = `${nodeId}-r2`;
                    const intermNode = nodes.find((n) => n.id === intermNodeId);
                    if (intermNode) {
                        intermNode.status = "active";
                        if (typeof payload["content"] === "string") {
                            const raw = payload["content"] as string;
                            intermNode.summary = formatRound2Summary(raw, intermNode.agentRole);
                            intermNode.content = raw;
                        }
                        if (payload["retrieval"] && typeof payload["retrieval"] === "object") {
                            intermNode.metadata = { ...(intermNode.metadata ?? {}), retrieval: payload["retrieval"] };
                        }
                    }

                    const msgType = payload["message_type"] as string | undefined;
                    const edgeKind: GraphEdgeKind =
                        msgType === "critique" ? "challenges" : "supports";
                    const rawTargetNodeId = inferTarget(
                        {
                            id: String(payload["message_id"] ?? ""),
                            agent_id: agentId,
                            agent_role: null,
                            message_type: msgType ?? "agent_response",
                            sender_type: "agent",
                            payload: payload,
                            text: String(payload["content"] ?? ""),
                            sequence_no: Number(payload["sequence_no"] ?? 0),
                            created_at: event.timestamp,
                        },
                        agents,
                        nodeId,
                    );
                    const targetIntermId = `${rawTargetNodeId}-r2`;
                    const edgeId = `edge-ws-${agentId}-r2-${edges.length}`;
                    edges.push({
                        id: edgeId,
                        source: intermNodeId,
                        target: targetIntermId,
                        kind: edgeKind,
                        round: 2,
                        status: "active",
                    });
                } else if (rn === 3) {
                    const intermId = `${nodeId}-r2`;
                    const sourceId = nodes.find((n) => n.id === intermId) ? intermId : nodeId;
                    const edgeId = `edge-${agentId}-synth`;
                    if (!edges.find((e) => e.id === edgeId)) {
                        edges.push({
                            id: edgeId,
                            source: sourceId,
                            target: SYNTHESIS_NODE_ID,
                            kind: "summarizes",
                            round: 3,
                            status: "active",
                        });
                    }
                }
            }
            break;
        }

        case "agent_completed": {
            if (event.agent_id) {
                const nodeId = `agent-${event.agent_id}`;
                const node = nodes.find((n) => n.id === nodeId);
                if (node) node.status = "completed";
            }
            break;
        }

        case "round_completed": {
            const rn = event.round_number ?? 0;
            // Mark round edges as completed
            edges.forEach((e) => {
                if (e.round === rn) e.status = "completed";
            });
            nodes.forEach((n) => {
                if (n.kind === "agent" && n.status === "active") {
                    n.status = "completed";
                }
                if (n.kind === "intermediate" && n.round === rn && n.status === "active") {
                    n.status = "completed";
                }
            });
            break;
        }

        case "turn_completed": {
            // Mark everything completed
            nodes.forEach((n) => {
                if (n.status !== "hidden") n.status = "completed";
            });
            edges.forEach((e) => {
                e.status = "completed";
            });
            // Reveal synthesis
            const synthNode = nodes.find((n) => n.id === SYNTHESIS_NODE_ID);
            if (synthNode) {
                synthNode.status = "completed";
                if (event.payload && typeof event.payload["final_summary"] === "string") {
                    synthNode.summary = event.payload["final_summary"] as string;
                    synthNode.content = event.payload["final_summary"] as string;
                }
            }
            // Ensure synthesis edges from intermediate nodes
            for (const agent of agents) {
                const intermId = `agent-${agent.id}-r2`;
                const sourceId = nodes.find((n) => n.id === intermId) ? intermId : `agent-${agent.id}`;
                const edgeId = `edge-${agent.id}-synth`;
                if (!edges.find((e) => e.id === edgeId)) {
                    edges.push({
                        id: edgeId,
                        source: sourceId,
                        target: SYNTHESIS_NODE_ID,
                        kind: "summarizes",
                        round: 3,
                        status: "completed",
                    });
                }
            }
            break;
        }

        default:
            break;
    }

    return { nodes, edges };
}

// ── Build timeline from session ──────────────────────────────────────

export function buildTimelineFromSession(
    session: SessionDetailDTO,
): TimelineRound[] {
    const turn = session.latest_turn;
    if (!turn) {
        return [
            { roundNumber: 1, roundType: "initial", status: "pending", label: "Initial Proposals", agentCount: session.agents?.length ?? 0 },
            { roundNumber: 2, roundType: "critique", status: "pending", label: "Debate & Critique", agentCount: session.agents?.length ?? 0 },
            { roundNumber: 3, roundType: "final", status: "pending", label: "Synthesis", agentCount: session.agents?.length ?? 0 },
        ];
    }

    const roundMap = new Map(turn.rounds.map((r) => [r.round_number, r]));
    const agentCount = session.agents?.length ?? 0;

    return [1, 2, 3].map((rn) => {
        const round = roundMap.get(rn);
        let status: TimelineRound["status"] = "pending";
        if (round) {
            if (round.status === "completed") status = "completed";
            else if (round.status === "running") status = "active";
            else if (round.status === "failed") status = "failed";
        }

        const labels: Record<number, string> = {
            1: "Initial Proposals",
            2: "Debate & Critique",
            3: "Synthesis",
        };
        const types: Record<number, TimelineRound["roundType"]> = {
            1: "initial",
            2: "critique",
            3: "final",
        };

        return {
            roundNumber: rn,
            roundType: types[rn] ?? "initial",
            status,
            label: labels[rn] ?? `Round ${rn}`,
            agentCount,
        };
    });
}

// ── Build moderator state ────────────────────────────────────────────

export function buildModeratorState(
    session: SessionDetailDTO | null,
    currentRound: number,
): ModeratorState {
    if (!session) {
        return {
            status: "Waiting",
            explanation: "No debate loaded yet.",
            watchFor: [],
            activityFeed: [],
        };
    }

    const turn = session.latest_turn;
    const turnStatus = turn?.status ?? "unknown";

    const feed: ActivityItem[] = [];

    if (turnStatus === "queued") {
        return {
            status: "Queued",
            explanation: "The debate is queued and will start shortly. Agents are being initialized.",
            watchFor: ["First agent responses appearing on the graph"],
            activityFeed: feed,
        };
    }

    // Build feed from rounds
    if (turn) {
        for (const round of turn.rounds) {
            feed.push({
                id: `round-start-${round.round_number}`,
                timestamp: round.started_at ?? "",
                text: `Round ${round.round_number} (${round.round_type}) started`,
                type: "round",
            });

            for (const msg of round.messages) {
                // Normalize error payloads into clean moderator messages
                const msgIsError = isErrorPayload(msg.payload ?? {}) || isErrorText(msg.text);
                const relatedNodeId = msg.agent_id
                    ? (round.round_number === 2 ? `agent-${msg.agent_id}-r2` : `agent-${msg.agent_id}`)
                    : undefined;
                if (msgIsError) {
                    const errInfo = normalizeAgentError(msg.payload ?? {}, msg.agent_id, msg.agent_role);
                    feed.push({
                        id: msg.id,
                        timestamp: msg.created_at,
                        text: formatModeratorError(msg.agent_role ?? "Agent", errInfo.errorType),
                        type: "error",
                        relatedNodeId,
                    });
                } else {
                    const formatted = formatModeratorEvent(
                        msg.agent_role,
                        msg.text,
                        msg.message_type,
                        round.round_number,
                    );
                    feed.push({
                        id: msg.id,
                        timestamp: msg.created_at,
                        text: formatted.title,
                        type: "agent",
                        relatedNodeId,
                    });
                }
            }

            if (round.status === "completed") {
                feed.push({
                    id: `round-end-${round.round_number}`,
                    timestamp: round.ended_at ?? "",
                    text: `Round ${round.round_number} completed`,
                    type: "round",
                });
            }
        }
    }

    const explanations: Record<number, string> = {
        1: "Agents are presenting their initial perspectives on the question. Each agent develops an independent viewpoint based on their reasoning style.",
        2: "Agents are now critiquing and building on each other's positions. Watch for emerging agreements and disagreements.",
        3: "The debate is converging. A synthesis is being formed from the strongest arguments presented across rounds.",
    };

    const watchForItems: Record<number, string[]> = {
        1: ["Agent node appearances", "Initial stances forming"],
        2: [
            "Challenge edges (red/pink links)",
            "Support edges (green links)",
            "Emerging consensus or polarization",
        ],
        3: [
            "Synthesis node appearing",
            "Final convergence pattern",
            "Resolution summary",
        ],
    };

    const statusLabels: Record<string, string> = {
        queued: "Queued",
        running: "Live",
        completed: "Completed",
        failed: "Failed",
    };

    return {
        status: statusLabels[turnStatus] ?? turnStatus,
        explanation:
            explanations[currentRound] ??
            "The debate is in progress.",
        watchFor: watchForItems[currentRound] ?? [],
        activityFeed: feed,
    };
}

// ── Get node status for visual ───────────────────────────────────────

export function getNodeStatusColor(status: GraphNodeStatus): string {
    switch (status) {
        case "active":
            return "#6366f1";
        case "completed":
            return "#10b981";
        case "visible":
            return "#4b5563";
        case "hidden":
        default:
            return "transparent";
    }
}
