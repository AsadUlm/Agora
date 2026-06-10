import type {
    DebateProcessModel,
    CritiqueThreadItem,
    CritiqueResponseItem,
    RevisedPositionItem,
} from "../model/debate-process.selectors";
import DebateRoundSection from "./DebateRoundSection";
import DebateThreadCard from "./DebateThreadCard";
import Round3SynthesisVerdict from "./Round3SynthesisVerdict";

interface DebateThreadViewProps {
    process: DebateProcessModel;
}

function emptyStageMessage(
    stageStatus: string,
    cycleStatus: DebateProcessModel["cycleStatus"],
    waiting: string,
    terminal: string,
): string {
    if (stageStatus === "running" || stageStatus === "queued") return waiting;
    if (cycleStatus === "completed" || cycleStatus === "partially_completed" || cycleStatus === "failed") {
        return terminal;
    }
    return "Not generated yet.";
}

const CritiqueDetails = ({ item }: { item: CritiqueThreadItem }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1.5">
        {item.targetClaim && (
            <div className="md:col-span-2 bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Challenged Claim</span>
                <p className="text-[11px] text-amber-200/70 italic">"{item.targetClaim}"</p>
            </div>
        )}
        {item.weaknessFound && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Weakness Found</span>
                <p className="text-[11px] text-rose-300/80">{item.weaknessFound}</p>
            </div>
        )}
        {item.assumptionAttacked && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Assumption Attacked</span>
                <p className="text-[11px] text-white/70">{item.assumptionAttacked}</p>
            </div>
        )}
        {item.whyItBreaks && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Why It Breaks</span>
                <p className="text-[11px] text-white/70">{item.whyItBreaks}</p>
            </div>
        )}
        {item.counterargument && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Counterargument</span>
                <p className="text-[11px] text-white/70">{item.counterargument}</p>
            </div>
        )}
        {item.realWorldImplication && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Real-world Implication</span>
                <p className="text-[11px] text-white/70">{item.realWorldImplication}</p>
            </div>
        )}
    </div>
);

const ResponseDetails = ({ item }: { item: CritiqueResponseItem }) => (
    <div className="space-y-2 text-xs pt-1.5">
        {item.challengeReceived && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Challenge Received</span>
                <p className="text-[11px] text-white/60 italic">"{item.challengeReceived}"</p>
            </div>
        )}
        <div className="bg-sky-500/5 p-2 rounded border border-sky-500/10">
            <span className="text-[10px] text-sky-300 uppercase tracking-wider font-semibold block mb-0.5">Response</span>
            <p className="text-[11px] text-white/75">{item.responseSummary}</p>
        </div>
        {item.acceptedPoints && item.acceptedPoints.length > 0 && (
            <div className="bg-emerald-500/5 border border-emerald-500/10 p-2 rounded">
                <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold block mb-0.5">Accepted Points</span>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-emerald-300/85">
                    {item.acceptedPoints.map((point, index) => <li key={index}>{point}</li>)}
                </ul>
            </div>
        )}
        {item.rejectedPoints && item.rejectedPoints.length > 0 && (
            <div className="bg-rose-500/5 border border-rose-500/10 p-2 rounded">
                <span className="text-[10px] text-rose-400 uppercase tracking-wider font-semibold block mb-0.5">Rejected Points</span>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-rose-300/85">
                    {item.rejectedPoints.map((point, index) => <li key={index}>{point}</li>)}
                </ul>
            </div>
        )}
        {item.plannedRevision && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Planned Revision</span>
                <p className="text-[11px] text-white/70">{item.plannedRevision}</p>
            </div>
        )}
    </div>
);

const RevisionDetails = ({ item }: { item: RevisedPositionItem }) => (
    <div className="space-y-2 text-xs pt-1.5">
        {item.initialSummary && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Initial</span>
                <p className="text-[11px] text-white/60 italic">"{item.initialSummary}"</p>
            </div>
        )}
        {item.critiqueReceived && (
            <div className="bg-rose-500/5 p-2 rounded border border-rose-500/10">
                <span className="text-[10px] text-rose-300 uppercase tracking-wider font-semibold block mb-0.5">Critique Received</span>
                <p className="text-[11px] text-white/65">{item.critiqueReceived}</p>
            </div>
        )}
        <div className="bg-amber-500/5 p-2 rounded border border-amber-500/10">
            <span className="text-[10px] text-amber-300 uppercase tracking-wider font-semibold block mb-0.5">Revised</span>
            <p className="text-[11px] text-white/80">{item.revisedSummary}</p>
        </div>
        <div className="bg-white/3 p-2 rounded border border-white/5">
            <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Change</span>
            <p className="text-[11px] text-white/75">{item.changeLabel}</p>
        </div>
        {item.reasonForChange && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Reason for change</span>
                <p className="text-[11px] text-white/75">{item.reasonForChange}</p>
            </div>
        )}
        {item.confidence && (
            <div className="bg-white/3 p-2 rounded border border-white/5">
                <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold block mb-0.5">Confidence Level</span>
                <p className="text-[11px] text-amber-200/80">{item.confidence}</p>
            </div>
        )}
    </div>
);

export default function DebateThreadView({ process }: DebateThreadViewProps) {
    const isFollowup = process.cycleType === "followup";
    const isRound2Active =
        process.round2.status !== "idle" &&
        (process.round2.crossCritiques.length > 0 ||
            process.round2.responsesToCritiques.length > 0 ||
            process.round2.revisedPositions.length > 0);

    return (
        <div className="space-y-4">
            {/* Question Card */}
            <div id="process-question" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 space-y-1">
                <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">
                    {isFollowup ? "FOLLOW-UP QUESTION" : "DEBATE QUESTION"}
                </p>
                <h1 className="text-xs font-semibold text-white leading-relaxed break-words font-sans">
                    {process.question}
                </h1>
            </div>

            {/* ROUND 1: INITIAL ANSWERS */}
            <DebateRoundSection
                title={isFollowup ? "FOLLOW-UP ROUND 1 — AGENT RESPONSES" : "Round 1 — Initial Answers"}
                subtitle={isFollowup
                    ? "Agents answer the follow-up question using the previous debate as context."
                    : "Each agent independently formulates their opening arguments and initial position."}
                status={process.round1.status}
            >
                <div className="grid grid-cols-1 gap-3">
                    {process.round1.initialAnswers.map((item) => (
                        <div key={item.id} id={`process-round1-${item.agentId}`}>
                            <DebateThreadCard
                                tone="initial"
                                sourceAgent={{ role: item.role, model: item.model }}
                                subtitle={item.stance}
                                summary={item.summary}
                                fullText={item.fullText}
                            />
                        </div>
                    ))}
                    {process.round1.initialAnswers.length === 0 && (
                        <div className="text-center py-4 text-xs text-white/30 italic">
                            {emptyStageMessage(
                                process.diagnostics.stageStatuses.stage1,
                                process.cycleStatus,
                                isFollowup ? "Waiting for follow-up responses..." : "Waiting for initial answers...",
                                isFollowup ? "No follow-up responses were generated." : "No initial answers were generated.",
                            )}
                        </div>
                    )}
                </div>
            </DebateRoundSection>

            {/* ROUND 2: DEBATE & CRITIQUE */}
            <DebateRoundSection
                title={isFollowup ? "FOLLOW-UP ROUND 2 — DEBATE & CRITIQUE" : "Round 2 — Debate & Critique"}
                subtitle={isFollowup
                    ? "Agents debate and critique the follow-up responses."
                    : "Agents challenge each other's assumptions, defend their stances, and revise their opening arguments."}
                status={process.round2.status}
            >
                {!isRound2Active && process.round2.status === "completed" ? (
                    <div className="rounded-lg bg-white/3 border border-white/5 p-4 text-center">
                        <p className="text-xs text-white/40 leading-relaxed italic">
                            No debate exchange messages were found for this debate.
                            <br />
                            Initial answers and final synthesis may still be available below.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* Subround 2.1 — Cross-Critiques */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                <h3 className="text-[11px] font-bold text-white/70 uppercase tracking-wide">
                                    {isFollowup ? "2.1 FOLLOW-UP CROSS-CRITIQUES" : <>2.1 Cross-Critiques · <span className="text-white/40 font-normal normal-case">Stage 2</span></>}
                                </h3>
                            </div>
                            <div className="grid grid-cols-1 gap-3 pl-3.5 border-l border-white/5">
                                {process.round2.crossCritiques.map((item) => (
                                    <div key={item.id} id={`process-critique-${item.sourceAgentId}-${item.targetAgentId}`}>
                                        <DebateThreadCard
                                            tone="challenge"
                                            sourceAgent={{ role: item.sourceAgentName }}
                                            targetAgent={
                                                item.targetAgentName
                                                    ? { role: item.targetAgentName }
                                                    : undefined
                                            }
                                            subtitle={item.targetClaim ? `Challenged: ${item.targetClaim.slice(0, 100)}...` : undefined}
                                            summary={item.challengeSummary}
                                            details={<CritiqueDetails item={item} />}
                                            fullText={item.fullText}
                                        />
                                    </div>
                                ))}
                                {process.round2.crossCritiques.length === 0 && (
                                    <div className="text-xs text-white/30 italic py-1">
                                        {emptyStageMessage(
                                            process.diagnostics.stageStatuses.stage2,
                                            process.cycleStatus,
                                            "Waiting for cross-critiques...",
                                            isFollowup
                                                ? "Cross-critiques were not generated in this follow-up cycle."
                                                : "Cross-critiques were not generated.",
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Subround 2.2 — Responses to Critiques */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                                <h3 className="text-[11px] font-bold text-white/70 uppercase tracking-wide">
                                    {isFollowup ? "2.2 RESPONSES TO FOLLOW-UP CRITIQUES" : <>2.2 Responses to Critiques · <span className="text-white/40 font-normal normal-case">Stage 3</span></>}
                                </h3>
                            </div>
                            <div className="grid grid-cols-1 gap-3 pl-3.5 border-l border-white/5">
                                {process.round2.responsesToCritiques.map((item) => (
                                    <div key={item.id} id={`process-response-${item.respondingAgentId}-${item.respondingToAgentId}`}>
                                        <DebateThreadCard
                                            tone="response"
                                            sourceAgent={{ role: item.respondingAgentName }}
                                            targetAgent={
                                                item.respondingToAgentName
                                                    ? { role: item.respondingToAgentName }
                                                    : undefined
                                            }
                                            summary={item.responseSummary}
                                            details={<ResponseDetails item={item} />}
                                            fullText={item.fullText}
                                        />
                                    </div>
                                ))}
                                {process.round2.responsesToCritiques.length === 0 && (
                                    <div className="text-xs text-white/30 italic py-1">
                                        {emptyStageMessage(
                                            process.diagnostics.stageStatuses.stage3,
                                            process.cycleStatus,
                                            "Waiting for responses to critiques...",
                                            isFollowup
                                                ? "Responses to critiques were not generated in this follow-up cycle."
                                                : "Responses to critiques were not generated.",
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Subround 2.3 — Revised Positions */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                <h3 className="text-[11px] font-bold text-white/70 uppercase tracking-wide">
                                    {isFollowup ? "2.3 REVISED FOLLOW-UP POSITIONS" : <>2.3 Revised Positions · <span className="text-white/40 font-normal normal-case">Stage 4</span></>}
                                </h3>
                            </div>
                            <div className="grid grid-cols-1 gap-3 pl-3.5 border-l border-white/5">
                                {process.round2.revisedPositions.map((item) => (
                                    <div key={item.id} id={`process-revision-${item.agentId}`}>
                                        <DebateThreadCard
                                            tone="revision"
                                            sourceAgent={{ role: item.agentName }}
                                            targetAgent={
                                                item.revisedAfterCritiqueFromAgentName
                                                    ? { role: item.revisedAfterCritiqueFromAgentName }
                                                    : undefined
                                            }
                                            relationLabel="revised after"
                                            targetSuffix="'s critique"
                                            summary={item.revisedSummary}
                                            changeBadge={item.changeLabel}
                                            changeBadgeColor={
                                                item.changeLabel === "Unchanged"
                                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                                    : item.changeLabel === "Unclear"
                                                        ? "bg-white/5 text-white/40 border-white/10"
                                                        : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                                            }
                                            details={<RevisionDetails item={item} />}
                                            fullText={item.fullText}
                                            subtitle={item.isInferred ? "Inferred revised position" : undefined}
                                        />
                                    </div>
                                ))}
                                {process.round2.revisedPositions.length === 0 && (
                                    <div className="text-xs text-white/30 italic py-1">
                                        {emptyStageMessage(
                                            process.diagnostics.stageStatuses.stage4,
                                            process.cycleStatus,
                                            "Waiting for revised positions...",
                                            isFollowup
                                                ? "Revised positions were not generated in this follow-up cycle."
                                                : "Revised positions were not generated.",
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </DebateRoundSection>

            {/* ROUND 3: FINAL SYNTHESIS & VERDICT */}
            <div id="process-final-verdict">
            <DebateRoundSection
                title={isFollowup ? "FOLLOW-UP ROUND 3 — UPDATED SYNTHESIS & VERDICT" : "Round 3 — Final Synthesis & Verdict"}
                subtitle={isFollowup
                    ? "The moderator updates the final answer based on this follow-up cycle."
                    : "The moderator analyzes the final arguments and synthesizes the consensus, winner, and trade-offs into the verdict."}
                status={process.round3.status}
            >
                <Round3SynthesisVerdict process={process} />
            </DebateRoundSection>
            </div>
        </div>
    );
}
