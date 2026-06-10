import type {
    AgentSynthesisItem,
    DebateProcessModel,
    ModeratorVerdictItem,
} from "../model/debate-process.selectors";
import {
    replaceGenericAgentLabels,
    type AgentDisplayInfo,
} from "../model/debate-display";

function cleanText(value: string | undefined, agents: AgentDisplayInfo[]): string {
    return replaceGenericAgentLabels(value ?? "", agents);
}

function meaningfulBadge(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    return normalized && !/^\d+(?:\.\d+)?$/.test(normalized) ? normalized : "";
}

function VerdictField({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: string;
    tone?: "neutral" | "consensus" | "disagreement";
}) {
    const toneClass = tone === "consensus"
        ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-100"
        : tone === "disagreement"
            ? "border-amber-500/25 bg-amber-500/5 text-amber-100"
            : "border-white/10 bg-white/5 text-white/85";

    return (
        <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
            <p className="text-[9px] uppercase tracking-widest text-white/45 font-semibold mb-1">{label}</p>
            <p className="text-[11px] leading-relaxed whitespace-pre-line">{value}</p>
        </div>
    );
}

function FinalVerdictCard({
    verdict,
    agents,
}: {
    verdict: ModeratorVerdictItem;
    agents: AgentDisplayInfo[];
}) {
    const takeaway = cleanText(verdict.oneSentenceTakeaway, agents);
    const recommendedAnswer = cleanText(verdict.recommendedAnswer, agents);
    const consensus = cleanText(verdict.consensusStatement, agents);
    const disagreement = cleanText(verdict.mainDisagreement, agents);
    const fullText = cleanText(verdict.fullText, agents);
    const winningSide = meaningfulBadge(cleanText(verdict.winningSide, agents));
    const confidence = meaningfulBadge(verdict.confidence);

    return (
        <div className="rounded-2xl border border-violet-400/50 bg-gradient-to-br from-violet-500/15 via-indigo-500/8 to-transparent p-4 space-y-3 shadow-lg shadow-violet-500/10">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-semibold">Unified Result</p>
                    <h3 className="text-base font-semibold text-white mt-0.5">Final Verdict</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {winningSide ? (
                        <span className="px-2 py-0.5 rounded-full border border-violet-400/30 bg-violet-500/15 text-[10px] text-violet-200">
                            {winningSide}
                        </span>
                    ) : null}
                    {confidence ? (
                        <span className="px-2 py-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-[10px] text-emerald-200">
                            {confidence} confidence
                        </span>
                    ) : null}
                </div>
            </div>

            {takeaway ? (
                <div className="rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 py-2.5">
                    <p className="text-[9px] uppercase tracking-widest text-violet-300 font-semibold mb-1">Takeaway</p>
                    <p className="text-[13px] font-medium text-white leading-relaxed">{takeaway}</p>
                </div>
            ) : null}

            <VerdictField label="Recommended Answer" value={recommendedAnswer} />

            {(consensus || disagreement) ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {consensus ? <VerdictField label="Consensus" value={consensus} tone="consensus" /> : null}
                    {disagreement ? <VerdictField label="Main Disagreement" value={disagreement} tone="disagreement" /> : null}
                </div>
            ) : null}

            {fullText ? (
                <details className="rounded-lg border border-white/10 bg-black/10">
                    <summary className="cursor-pointer px-3 py-2 text-[10px] uppercase tracking-wider text-violet-200">
                        Show full moderator answer
                    </summary>
                    <p className="px-3 pb-3 text-xs text-white/75 leading-relaxed whitespace-pre-wrap">
                        {fullText}
                    </p>
                </details>
            ) : null}
        </div>
    );
}

function WhyVerdictWasReached({
    steps,
    agents,
}: {
    steps: string[];
    agents: AgentDisplayInfo[];
}) {
    return (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-3 py-3">
            <p className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold mb-2">
                Why This Verdict
            </p>
            <ol className="space-y-1.5">
                {steps.map((step, index) => (
                    <li key={`${index}-${step}`} className="flex items-start gap-2 text-[11px] text-white/70 leading-relaxed">
                        <span className="text-indigo-300 font-semibold shrink-0">{index + 1}.</span>
                        <span>{cleanText(step, agents)}</span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function CompactAgentSynthesisCard({
    item,
    agents,
}: {
    item: AgentSynthesisItem;
    agents: AgentDisplayInfo[];
}) {
    const takeaway = cleanText(item.takeaway ?? item.summary ?? item.finalPosition, agents);
    const finalPosition = cleanText(item.finalPosition, agents);
    const fullText = cleanText(item.fullText, agents);
    const confidence = meaningfulBadge(item.confidence);

    return (
        <div className="rounded-lg border border-white/10 bg-white/3 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-white uppercase tracking-wide">{item.agentName}</p>
                {confidence ? (
                    <span className="px-2 py-0.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-200">
                        {confidence}
                    </span>
                ) : null}
            </div>
            <p className="text-[11px] text-white/70 leading-relaxed">
                <span className="text-white/40 font-semibold">Takeaway: </span>{takeaway}
            </p>
            {finalPosition && finalPosition !== takeaway ? (
                <p className="text-[11px] text-white/55 leading-relaxed line-clamp-2">
                    <span className="text-white/40 font-semibold">Final position: </span>{finalPosition}
                </p>
            ) : null}
            {fullText ? (
                <details className="rounded border border-white/8 bg-black/10">
                    <summary className="cursor-pointer px-2 py-1.5 text-[9px] uppercase tracking-wider text-indigo-300">
                        Show full response
                    </summary>
                    <p className="px-2 pb-2 text-[11px] text-white/65 leading-relaxed whitespace-pre-wrap">
                        {fullText}
                    </p>
                </details>
            ) : null}
        </div>
    );
}

function CollapsibleAgentSynthesisSummary({
    reports,
    agents,
}: {
    reports: AgentSynthesisItem[];
    agents: AgentDisplayInfo[];
}) {
    return (
        <details className="rounded-xl border border-white/10 bg-white/3">
            <summary className="cursor-pointer px-3 py-3 flex items-center justify-between gap-3 list-none">
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/65 font-semibold">Agent synthesis details</p>
                    <p className="text-[10px] text-white/35 mt-0.5">
                        {reports.length} agent synthesis report{reports.length === 1 ? "" : "s"} available
                    </p>
                </div>
                <span className="text-[10px] text-indigo-300 font-medium">Show details</span>
            </summary>
            <div className="px-3 pb-3 pt-1 border-t border-white/5 grid grid-cols-1 gap-2">
                {reports.map((item) => (
                    <CompactAgentSynthesisCard key={item.id} item={item} agents={agents} />
                ))}
            </div>
        </details>
    );
}

export default function Round3SynthesisVerdict({ process }: { process: DebateProcessModel }) {
    const { moderatorVerdict, agentSyntheses, howReached, status } = process.round3;
    const displayAgents = process.agents.map((agent) => ({ displayName: agent.role }));
    const hasAgentSyntheses = agentSyntheses.length > 0;

    return (
        <div className="space-y-4">
            {moderatorVerdict ? <FinalVerdictCard verdict={moderatorVerdict} agents={displayAgents} /> : null}

            {moderatorVerdict && howReached.length > 0 ? (
                <WhyVerdictWasReached steps={howReached} agents={displayAgents} />
            ) : null}

            {!moderatorVerdict && (status === "running" || (status === "idle" && process.cycleStatus === "running")) ? (
                <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3 text-xs text-indigo-200">
                    {process.cycleType === "followup"
                        ? "Updated synthesis is being generated..."
                        : "Final synthesis is still running..."}
                </div>
            ) : null}

            {!moderatorVerdict && status === "failed" ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
                    Final synthesis failed, but debate exchange is available.
                </div>
            ) : null}

            {!moderatorVerdict
                && status !== "running"
                && process.cycleStatus === "partially_completed"
                && process.cycleType === "followup"
                && !hasAgentSyntheses ? (
                    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">
                        Updated synthesis was not generated. Available follow-up responses are shown above.
                    </div>
                ) : null}

            {!moderatorVerdict && status !== "failed" && status !== "running" && hasAgentSyntheses ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">
                    Moderator verdict was not found in the saved debate snapshot. Agent synthesis reports are available.
                </div>
            ) : null}

            {!moderatorVerdict && status === "completed" && !hasAgentSyntheses ? (
                <div className="rounded-lg border border-white/10 bg-white/3 p-3 text-xs text-white/50">
                    No unified verdict or agent synthesis reports were found in the saved debate snapshot.
                </div>
            ) : null}

            {hasAgentSyntheses ? (
                <CollapsibleAgentSynthesisSummary reports={agentSyntheses} agents={displayAgents} />
            ) : null}
        </div>
    );
}
