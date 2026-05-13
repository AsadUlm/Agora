import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGraphStore } from "../model/graph.store";
import { useDebateStore } from "../model/debate.store";
import { getPersonaMeta } from "../model/persona-meta";
import { extractFullResponse, getTurnSummary, normalizeSummary, parseResponsePayload } from "../model/formatters";
import { cn } from "@/shared/lib/cn";

const kindLabels: Record<string, string> = {
    question: "Question",
    agent: "Agent Response",
    synthesis: "Synthesis",
    intermediate: "Agent Interaction",
    "followup-question": "Follow-up Question",
    "followup-agent": "Follow-up Response",
    "followup-intermediate": "Follow-up Critique",
    "followup-synthesis": "Updated Synthesis",
};

const roundLabels: Record<number, string> = {
    1: "Round 1",
    2: "Round 2",
    3: "Round 3",
};

const roundGuidance: Record<number, string> = {
    1: "Opening response: the agent establishes its initial position.",
    2: "Cross-examination: the agent challenges or supports another viewpoint.",
    3: "Final synthesis: the agent converges on a refined final position.",
};

interface RetrievalChunkPreview {
    text: string;
    score: number;
}

interface RetrievalDocumentGroup {
    document_id: string;
    document_name: string;
    chunks: RetrievalChunkPreview[];
}

interface RetrievalSummary {
    documents: RetrievalDocumentGroup[];
    total_chunks: number;
}

interface ContentSection {
    heading: string;
    body: string;
}

function parseRetrieval(meta: unknown): RetrievalSummary | null {
    if (!meta || typeof meta !== "object") return null;
    const retrieval = (meta as Record<string, unknown>)["retrieval"];
    if (!retrieval || typeof retrieval !== "object") return null;

    const obj = retrieval as Record<string, unknown>;
    const docs = obj["documents"];
    if (!Array.isArray(docs)) return null;

    return {
        documents: docs as RetrievalDocumentGroup[],
        total_chunks: typeof obj["total_chunks"] === "number" ? (obj["total_chunks"] as number) : 0,
    };
}

function relationLabel(kind: string, outgoing: boolean): string {
    if (kind === "challenges") return outgoing ? "challenges" : "is challenged by";
    if (kind === "supports") return outgoing ? "supports" : "is supported by";
    if (kind === "questions") return outgoing ? "questions" : "is questioned by";
    if (kind === "summarizes") return outgoing ? "feeds into" : "receives synthesis from";
    if (kind === "initial") return outgoing ? "continues to" : "continues from";
    return outgoing ? "connects to" : "connected from";
}

function normalizeScalar(value: unknown): string {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";
        return normalizeSummary(trimmed, trimmed, 280);
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

function firstScalar(parsed: Record<string, unknown> | null, keys: string[]): string {
    if (!parsed) return "";
    for (const key of keys) {
        const value = normalizeScalar(parsed[key]);
        if (value) return value;
    }
    return "";
}

function scalarList(parsed: Record<string, unknown> | null, keys: string[]): string[] {
    if (!parsed) return [];

    for (const key of keys) {
        const value = parsed[key];
        if (!Array.isArray(value)) continue;

        const normalized = value
            .map((item) => {
                if (typeof item === "string") return item.trim();
                if (typeof item === "number" || typeof item === "boolean") return String(item);
                if (typeof item === "object" && item !== null) {
                    const obj = item as Record<string, unknown>;
                    return (
                        normalizeScalar(obj["text"])
                        || normalizeScalar(obj["value"])
                        || normalizeScalar(obj["challenge"])
                        || normalizeScalar(obj["point"])
                    );
                }
                return "";
            })
            .filter((item) => item.length > 0);

        if (normalized.length > 0) return normalized;
    }

    return [];
}

function pushSection(target: ContentSection[], heading: string, body: string) {
    const normalized = body.trim();
    if (!normalized) return;
    target.push({ heading, body: normalized });
}

function mergeSections(sections: ContentSection[]): ContentSection[] {
    const merged = new Map<string, string>();
    const ordered: string[] = [];

    for (const section of sections) {
        const body = section.body.trim();
        if (!body) continue;

        if (!merged.has(section.heading)) {
            merged.set(section.heading, body);
            ordered.push(section.heading);
            continue;
        }

        const existing = merged.get(section.heading) ?? "";
        if (existing.includes(body)) continue;
        merged.set(section.heading, `${existing}\n\n${body}`.trim());
    }

    return ordered.map((heading) => ({
        heading,
        body: merged.get(heading) ?? "",
    }));
}

function buildSections(args: {
    round: number;
    kind: string;
    parsed: Record<string, unknown> | null;
    fullResponse: string;
}): ContentSection[] {
    const { round, kind, parsed, fullResponse } = args;
    const sections: ContentSection[] = [];
    const isRound3 = round === 3 || kind === "synthesis";

    const shortSummary = firstScalar(parsed, ["one_sentence_takeaway", "short_summary", "summary"]);
    if (shortSummary && !isRound3) {
        pushSection(sections, "Key Takeaway", shortSummary);
    }

    if (round === 1) {
        pushSection(sections, "Stance", firstScalar(parsed, ["stance", "position"]));
        pushSection(sections, "Main Argument", firstScalar(parsed, ["main_argument"]));
        const keyPoints = scalarList(parsed, ["key_points"]);
        if (keyPoints.length > 0) {
            pushSection(sections, "Key Points", `• ${keyPoints.join("\n• ")}`);
        }
        pushSection(sections, "Risks / Caveats", firstScalar(parsed, ["risks_or_caveats", "risks"]));
    } else if (round === 2 || kind === "intermediate") {
        pushSection(sections, "Target", firstScalar(parsed, ["target_role", "target_agent"]));
        pushSection(sections, "Challenge", firstScalar(parsed, ["challenge", "critique"]));
        pushSection(sections, "Assumption Attacked", firstScalar(parsed, ["assumption_attacked"]));
        pushSection(sections, "Why It Breaks", firstScalar(parsed, ["why_it_breaks"]));
        pushSection(sections, "Real-World Implication", firstScalar(parsed, ["real_world_implication"]));
        pushSection(sections, "Weakness Found", firstScalar(parsed, ["weakness_found", "weakness"]));
        pushSection(sections, "Counterargument", firstScalar(parsed, ["counterargument", "counter_evidence"]));
    } else if (isRound3) {
        if (shortSummary) {
            pushSection(sections, "Key Takeaway", shortSummary);
        }
        pushSection(sections, "Final Position / Argument", firstScalar(parsed, ["final_position", "final_stance", "response", "display_content"]));
        pushSection(sections, "Key Trade-off", firstScalar(parsed, ["key_tradeoff", "tradeoff"]));
        pushSection(sections, "Winning Argument", firstScalar(parsed, ["winning_argument", "strongest_argument"]));
        pushSection(sections, "Losing Argument", firstScalar(parsed, ["losing_argument"]));
        const confidence = (firstScalar(parsed, ["confidence"]) || "").toLowerCase();
        if (confidence) {
            pushSection(sections, "Confidence", confidence.toUpperCase());
        }
        pushSection(sections, "What Changed", firstScalar(parsed, ["what_changed"]));
        pushSection(sections, "Concerns", firstScalar(parsed, ["remaining_concerns"]));
        pushSection(sections, "Conclusion", firstScalar(parsed, ["conclusion", "recommendation"]));
    }

    // Follow-up cycle sections (cycle ≥ 2)
    if (kind === "followup-agent") {
        pushSection(sections, "Quick Takeaway", firstScalar(parsed, ["one_sentence_takeaway", "quick_takeaway", "short_summary"]));
        pushSection(sections, "Full Answer", firstScalar(parsed, ["full_answer", "answer_to_followup", "response", "display_content"]));

        // Position Change — prefer structured position_evolution
        const evolution = (parsed?.position_evolution ?? null) as Record<string, unknown> | null;
        if (evolution && typeof evolution === "object") {
            const prev = firstScalar(evolution, ["previous_position"]);
            const updated = firstScalar(evolution, ["updated_position"]);
            // Accept both ``change_type`` (legacy) and ``change`` (Step 25 simplified).
            const changeType = firstScalar(evolution, ["change_type", "change"]);
            const reason = firstScalar(evolution, ["reason"]);
            const lines: string[] = [];
            if (changeType) lines.push(`Change: ${changeType.toUpperCase()}`);
            if (prev) lines.push(`Previous: ${prev}`);
            if (updated) lines.push(`Updated: ${updated}`);
            if (reason) lines.push(`Reason: ${reason}`);
            if (lines.length > 0) {
                pushSection(sections, "Position Change", lines.join("\n"));
            }
        } else {
            pushSection(sections, "Position Change", firstScalar(parsed, ["position_change", "position_update", "what_changed"]));
        }

        const fuKeyPoints = scalarList(parsed, ["key_points", "supporting_points"]);
        if (fuKeyPoints.length > 0) {
            pushSection(sections, "Key Points", `• ${fuKeyPoints.join("\n• ")}`);
        }
    } else if (kind === "followup-synthesis") {
        pushSection(sections, "Quick Takeaway", firstScalar(parsed, ["one_sentence_takeaway", "quick_takeaway", "short_summary"]));
        pushSection(sections, "Updated Conclusion", firstScalar(parsed, ["updated_conclusion", "full_answer", "response", "display_content"]));
        const changed = (firstScalar(parsed, ["conclusion_changed"]) || "").toLowerCase();
        if (changed) {
            pushSection(sections, "Conclusion Changed", changed === "yes" ? "YES — the follow-up shifted the conclusion." : "NO — the conclusion holds.");
        }
        pushSection(sections, "Why", firstScalar(parsed, ["change_reason", "what_changed"]));
        pushSection(sections, "Key Trade-off", firstScalar(parsed, ["key_tradeoff", "tradeoff"]));
        pushSection(sections, "Winning Argument", firstScalar(parsed, ["winning_argument", "strongest_argument"]));
        pushSection(sections, "Losing Argument", firstScalar(parsed, ["losing_argument"]));
        const fuConfidence = (firstScalar(parsed, ["confidence"]) || "").toLowerCase();
        if (fuConfidence) {
            pushSection(sections, "Confidence", fuConfidence.toUpperCase());
        }
        pushSection(sections, "Strongest Argument", firstScalar(parsed, ["strongest_argument"]));
        pushSection(sections, "Remaining Disagreement", firstScalar(parsed, ["remaining_disagreement", "remaining_concerns"]));
    } else if (kind === "followup-intermediate") {
        const targetKind = (firstScalar(parsed, ["target_kind"]) || "").toLowerCase();
        const targetLabel = targetKind === "strongest_argument"
            ? "Target (strongest argument)"
            : targetKind === "unresolved_question"
                ? "Target (unresolved question)"
                : "Target";
        pushSection(sections, targetLabel, firstScalar(parsed, ["target_agent", "target_role"]));
        pushSection(sections, "Challenge", firstScalar(parsed, ["challenge", "critique"]));
        pushSection(sections, "Assumption Attacked", firstScalar(parsed, ["assumption_attacked"]));
        pushSection(sections, "Why It Breaks", firstScalar(parsed, ["why_it_breaks"]));
        pushSection(sections, "Real-World Implication", firstScalar(parsed, ["real_world_implication"]));
        pushSection(sections, "Counterargument", firstScalar(parsed, ["counterargument"]));
        pushSection(sections, "Impact", firstScalar(parsed, ["impact"]));
    } else if (kind === "followup-question") {
        pushSection(sections, "Follow-up Question", firstScalar(parsed, ["question"]) || fullResponse);
    }

    if (fullResponse && !isRound3) {
        pushSection(sections, "Full Response", fullResponse);
    }

    if (sections.length === 0 && fullResponse) {
        pushSection(sections, isRound3 ? "Final Position / Argument" : "Response", fullResponse);
    }

    return mergeSections(sections);
}

function QuickTakeawayBox({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const isLong = text.length > 140;

    return (
        <div className="rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-violet-500/5 p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">Quick Takeaway</span>
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className="text-[10px] text-violet-300/70 hover:text-violet-200 transition-colors"
                    >
                        {open ? "Show less" : "Show more"}
                    </button>
                )}
            </div>
            <p className={cn(
                "text-[15px] text-white leading-relaxed font-medium text-justify transition-all",
                !open && isLong ? "line-clamp-2" : "",
            )}>
                {text}
            </p>
        </div>
    );
}

export default function NodeDetailDrawer() {
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);
    const debateQuestion = useDebateStore((s) => s.session?.question ?? "");
    const agents = useDebateStore((s) => s.agents);

    const node = selectedNodeId
        ? graph.nodes.find((n) => n.id === selectedNodeId)
        : null;

    const agent = node?.agentId ? agents.find((a) => a.id === node.agentId) : null;

    const relatedEdges = selectedNodeId
        ? graph.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
        : [];

    const isLoading = Boolean(node?.metadata?.["loading"] && !node?.content);
    const rawOutputValue = node?.metadata?.["rawOutput"];
    const rawOutput = typeof rawOutputValue === "string" ? rawOutputValue.trim() : "";
    const isFallbackFormatted = node?.metadata?.["isFallback"] === true;

    const quickTakeaway = useMemo(() => {
        if (!node) return "";
        const raw = node.summary || node.content;
        // If raw is already plain text (not JSON), use it directly
        const trimmed = (raw ?? "").trimStart();
        if (!trimmed.startsWith("{")) {
            return trimmed.slice(0, 180);
        }
        // Raw is JSON — extract the summary field before displaying
        try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            for (const key of ["short_summary", "summary", "final_position", "final_stance", "stance", "conclusion"]) {
                if (typeof parsed[key] === "string" && (parsed[key] as string).trim()) {
                    return (parsed[key] as string).trim().slice(0, 180);
                }
            }
        } catch {
            // not valid JSON, fall through
        }
        return getTurnSummary({
            raw,
            round: node.round,
            kind: node.kind,
            sourceRole: node.agentRole,
            maxLen: 180,
        });
    }, [node]);

    const parsedPayload = useMemo(
        () => parseResponsePayload(node?.content || node?.summary || null),
        [node?.content, node?.summary],
    );

    const fullResponse = useMemo(
        () => extractFullResponse(node?.content || node?.summary || null),
        [node?.content, node?.summary],
    );

    const contentSections = useMemo(() => {
        if (!node || isLoading) return [];
        return buildSections({
            round: node.round,
            kind: node.kind,
            parsed: parsedPayload,
            fullResponse,
        });
    }, [node, isLoading, parsedPayload, fullResponse]);

    const retrieval = useMemo(() => parseRetrieval(node?.metadata), [node]);

    return (
        <AnimatePresence>
            {node && (
                <motion.aside
                    initial={{ x: "100%", opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "100%", opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 34 }}
                    className="absolute top-0 right-0 h-full bg-agora-surface border-l border-agora-border shadow-2xl shadow-black/50 z-50 flex flex-col" style={{ width: "clamp(320px, 34vw, 520px)" }}
                >
                    <div className="px-5 py-4 border-b border-agora-border flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                                {kindLabels[node.kind] ?? node.kind}
                            </div>
                            <div className="text-base font-semibold text-white leading-tight truncate">
                                {node.agentRole || node.label}
                            </div>
                            {(agent || node.agentRole) && (() => {
                                const persona = getPersonaMeta(node.agentRole);
                                return (
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        {persona && (
                                            <span
                                                className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${persona.accentChip} ${persona.accentText}`}
                                                title="Persona archetype"
                                            >
                                                {persona.title}
                                            </span>
                                        )}
                                        {agent?.model && (
                                            <span
                                                className="text-[10px] px-1.5 py-0.5 rounded border border-agora-border bg-agora-surface-light/40 text-agora-text-muted font-mono truncate max-w-[200px]"
                                                title={`${agent.provider ?? ""} · ${agent.model}`}
                                            >
                                                {agent.model.includes("/") ? agent.model.split("/").slice(-1)[0] : agent.model}
                                            </span>
                                        )}
                                        {agent?.temperature != null && (
                                            <span
                                                className="text-[10px] px-1.5 py-0.5 rounded border border-agora-border bg-agora-surface-light/40 text-agora-text-muted"
                                                title="Temperature (live or persona-resolved)"
                                            >
                                                t={agent.temperature.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                        <button
                            type="button"
                            onClick={() => selectNode(null)}
                            className="w-8 h-8 rounded-lg bg-agora-surface-light flex items-center justify-center text-agora-text-muted hover:text-white hover:bg-gray-600 transition-colors shrink-0"
                            aria-label="Close details"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge>{roundLabels[node.round] ?? `Round ${node.round}`}</Badge>
                            {node.cycle && node.cycle >= 2 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-[10px] text-violet-200 font-medium">
                                    Follow-up #{node.cycle - 1}
                                </span>
                            )}
                            <StatusBadge status={node.status} />
                            <Badge>{kindLabels[node.kind] ?? node.kind}</Badge>
                            {node.agentRole && <Badge>{node.agentRole}</Badge>}
                            {isFallbackFormatted && <Badge>Formatted automatically</Badge>}
                        </div>

                        {node.round > 0 && roundGuidance[node.round] && (
                            <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-3 py-2">
                                <p className="text-xs text-indigo-100/95 leading-relaxed">
                                    {roundGuidance[node.round]}
                                </p>
                            </div>
                        )}

                        {quickTakeaway && <QuickTakeawayBox text={quickTakeaway} />}

                        {debateQuestion && (
                            <details className="rounded-lg border border-agora-border bg-agora-surface-light/20" open={node.kind === "question"}>
                                <summary className="px-3 py-2 text-[11px] text-agora-text-muted cursor-pointer select-none">
                                    Debate question
                                </summary>
                                <div className="px-3 pb-3">
                                    <p className="text-xs text-agora-text leading-relaxed whitespace-pre-wrap break-words">
                                        {debateQuestion}
                                    </p>
                                </div>
                            </details>
                        )}

                        {isLoading && (
                            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
                                <Label>Generating</Label>
                                <p className="text-xs text-indigo-100 leading-relaxed">
                                    This response is still being generated. Details appear as soon as output is ready.
                                </p>
                            </div>
                        )}

                        {node.status === "failed" && (
                            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                                <Label>Generation Failed</Label>
                                <p className="text-xs text-red-100 leading-relaxed">
                                    This agent response failed to generate.
                                </p>
                            </div>
                        )}

                        {!isLoading && contentSections.length > 0 && (
                            <section className="space-y-2.5">
                                <Label>{node.round === 3 || node.kind === "synthesis" ? "Analysis" : "Details"}</Label>
                                {contentSections.map((section, idx) => (
                                    <div
                                        key={`${section.heading}-${idx}`}
                                        className="rounded-lg border border-agora-border/70 bg-agora-surface-light/20 p-3"
                                    >
                                        <div className="text-[11px] uppercase tracking-wide text-agora-text-muted font-semibold mb-1.5">
                                            {section.heading}
                                        </div>
                                        <SectionBody body={section.body} />
                                    </div>
                                ))}
                            </section>
                        )}

                        {!isLoading && retrieval && retrieval.documents.length > 0 && (
                            <div className="pt-2 border-t border-agora-border/40">
                                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted/80 font-semibold mb-2 px-1">
                                    Advanced
                                </div>
                                <details className="rounded-lg border border-indigo-500/30 bg-indigo-500/5">
                                    <summary className="px-3 py-2 text-[11px] text-indigo-200 cursor-pointer select-none">
                                        Sources ({retrieval.total_chunks} chunks from {retrieval.documents.length} {retrieval.documents.length === 1 ? "document" : "documents"})
                                    </summary>
                                    <div className="px-3 pb-3 space-y-3">
                                        {retrieval.documents.map((doc) => (
                                            <div key={doc.document_id} className="space-y-1.5">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="text-[11px] font-medium text-white truncate" title={doc.document_name}>
                                                        {doc.document_name}
                                                    </div>
                                                    <div className="text-[10px] text-agora-text-muted whitespace-nowrap">
                                                        {doc.chunks.length} {doc.chunks.length === 1 ? "chunk" : "chunks"}
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    {doc.chunks.map((chunk, ci) => (
                                                        <div key={ci} className="rounded-md bg-agora-surface-light/40 px-2.5 py-2">
                                                            <div className="flex items-start gap-2">
                                                                <p className="text-[11px] text-agora-text leading-relaxed flex-1 whitespace-pre-line break-words">
                                                                    {chunk.text}
                                                                </p>
                                                                <span className="text-[10px] font-mono text-indigo-200 bg-indigo-500/20 rounded px-1.5 py-0.5 flex-shrink-0">
                                                                    {chunk.score.toFixed(2)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            </div>
                        )}

                        {relatedEdges.length > 0 && (
                            <details className="rounded-lg border border-agora-border bg-agora-surface-light/15">
                                <summary className="px-3 py-2 text-[11px] text-agora-text-muted cursor-pointer select-none">
                                    Connections ({relatedEdges.length})
                                </summary>
                                <div className="px-3 pb-3 space-y-1.5">
                                    {relatedEdges.map((edge) => {
                                        const outgoing = edge.source === selectedNodeId;
                                        const otherNodeId = outgoing ? edge.target : edge.source;
                                        const otherNode = graph.nodes.find((n) => n.id === otherNodeId);
                                        return (
                                            <button
                                                key={edge.id}
                                                type="button"
                                                onClick={() => selectNode(otherNodeId)}
                                                className="w-full text-left px-2.5 py-1.5 rounded-lg bg-agora-surface-light/30 hover:bg-agora-surface-light/60 transition-colors text-xs"
                                            >
                                                <span className="text-agora-text-muted">{outgoing ? "→" : "←"}</span>{" "}
                                                <span className="text-white">
                                                    {otherNode?.agentRole || otherNode?.label || otherNodeId}
                                                </span>
                                                <span className="ml-1.5 text-[10px] text-agora-text-muted italic">
                                                    {relationLabel(edge.kind, outgoing)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </details>
                        )}

                        {!isLoading && rawOutput && (
                            <details className="rounded-lg border border-agora-border bg-agora-surface-light/10">
                                <summary className="px-3 py-2 text-[11px] text-agora-text-muted cursor-pointer select-none">
                                    Raw model output (debug)
                                </summary>
                                <div className="px-3 pb-3">
                                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-agora-text-muted max-h-56 overflow-y-auto">
                                        {rawOutput}
                                    </pre>
                                </div>
                            </details>
                        )}
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}

function Label({ children }: { children: ReactNode }) {
    return (
        <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-1.5">
            {children}
        </div>
    );
}

function Badge({ children }: { children: ReactNode }) {
    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-agora-surface-light/50 text-[10px] text-agora-text-muted font-medium capitalize">
            {children}
        </span>
    );
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        active: "bg-indigo-500/20 text-indigo-300",
        completed: "bg-emerald-500/20 text-emerald-300",
        failed: "bg-red-500/20 text-red-300",
        visible: "bg-gray-500/20 text-gray-300",
        hidden: "bg-gray-700/20 text-gray-500",
    };

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[status] ?? colors.visible}`}>
            {status}
        </span>
    );
}

function SectionBody({ body }: { body: string }) {
    const lines = body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    const isBulletOnly = lines.length > 1 && lines.every((line) => line.startsWith("•"));
    if (isBulletOnly) {
        return (
            <ul className="space-y-1">
                {lines.map((line, idx) => (
                    <li key={idx} className="text-xs text-agora-text leading-relaxed text-justify">
                        {line.replace(/^•\s*/, "")}
                    </li>
                ))}
            </ul>
        );
    }

    const paragraphs = body
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return (
        <div className="space-y-2">
            {(paragraphs.length > 0 ? paragraphs : [body]).map((paragraph, idx) => (
                <p key={idx} className="text-xs text-agora-text leading-relaxed whitespace-pre-line text-justify">
                    {paragraph}
                </p>
            ))}
        </div>
    );
}
