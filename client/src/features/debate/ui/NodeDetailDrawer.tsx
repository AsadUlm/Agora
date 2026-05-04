import { useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGraphStore } from "../model/graph.store";
import { useDebateStore } from "../model/debate.store";
import { extractFullResponse, getTurnSummary, parseResponsePayload } from "../model/formatters";

const kindLabels: Record<string, string> = {
    question: "Question",
    agent: "Agent Response",
    synthesis: "Synthesis",
    intermediate: "Agent Interaction",
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
    if (typeof value === "string") return value.trim();
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

    const shortSummary = firstScalar(parsed, ["short_summary", "summary"]);
    if (shortSummary) {
        pushSection(sections, "Short Summary", shortSummary);
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
        pushSection(sections, "Weakness Found", firstScalar(parsed, ["weakness_found", "weakness"]));
        pushSection(sections, "Counterargument", firstScalar(parsed, ["counterargument", "counter_evidence"]));
    } else if (round === 3 || kind === "synthesis") {
        pushSection(sections, "Final Position", firstScalar(parsed, ["final_position", "final_stance"]));
        pushSection(sections, "What Changed", firstScalar(parsed, ["what_changed"]));
        pushSection(sections, "Remaining Concerns", firstScalar(parsed, ["remaining_concerns"]));
        pushSection(sections, "Conclusion", firstScalar(parsed, ["conclusion", "recommendation"]));
    }

    if (fullResponse) {
        pushSection(sections, "Full Response", fullResponse);
    }

    return mergeSections(sections);
}

export default function NodeDetailDrawer() {
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
    const graph = useGraphStore((s) => s.graph);
    const selectNode = useGraphStore((s) => s.selectNode);
    const debateQuestion = useDebateStore((s) => s.session?.question ?? "");

    const node = selectedNodeId
        ? graph.nodes.find((n) => n.id === selectedNodeId)
        : null;

    const relatedEdges = selectedNodeId
        ? graph.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
        : [];

    const isLoading = Boolean(node?.metadata?.["loading"] && !node?.content);
    const rawOutput = (node?.content || node?.summary || "").trim();

    const quickTakeaway = useMemo(() => {
        if (!node) return "";
        return getTurnSummary({
            raw: node.summary || node.content,
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
        }).slice(0, 8);
    }, [node, isLoading, parsedPayload, fullResponse]);

    const retrieval = useMemo(() => parseRetrieval(node?.metadata), [node]);

    return (
        <AnimatePresence>
            {node && (
                <motion.aside
                    initial={{ x: 420, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 420, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 34 }}
                    className="absolute top-0 right-0 h-full w-[460px] max-w-[94vw] bg-agora-surface border-l border-agora-border shadow-2xl shadow-black/50 z-50 flex flex-col"
                >
                    <div className="px-5 py-4 border-b border-agora-border flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                                {kindLabels[node.kind] ?? node.kind}
                            </div>
                            <div className="text-base font-semibold text-white leading-tight">
                                {node.agentRole || node.label}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => selectNode(null)}
                            className="w-8 h-8 rounded-lg bg-agora-surface-light flex items-center justify-center text-agora-text-muted hover:text-white hover:bg-gray-600 transition-colors"
                            aria-label="Close details"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge>{roundLabels[node.round] ?? `Round ${node.round}`}</Badge>
                            <StatusBadge status={node.status} />
                            <Badge>{kindLabels[node.kind] ?? node.kind}</Badge>
                            {node.agentRole && <Badge>{node.agentRole}</Badge>}
                        </div>

                        {node.round > 0 && (
                            <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/8 px-3 py-2">
                                <p className="text-xs text-indigo-100/95 leading-relaxed">
                                    {roundGuidance[node.round] ?? "This message is part of the debate process."}
                                </p>
                            </div>
                        )}

                        {quickTakeaway && (
                            <div className="rounded-xl border border-agora-border bg-agora-surface-light/30 p-3">
                                <Label>Quick Takeaway</Label>
                                <p className="text-sm text-white leading-relaxed">
                                    {quickTakeaway}
                                </p>
                            </div>
                        )}

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
                                <Label>Details</Label>
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
                    <li key={idx} className="text-xs text-agora-text leading-relaxed">
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
                <p key={idx} className="text-xs text-agora-text leading-relaxed whitespace-pre-line">
                    {paragraph}
                </p>
            ))}
        </div>
    );
}
