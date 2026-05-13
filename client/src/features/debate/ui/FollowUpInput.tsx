import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useDebateStore } from "../model/debate.store";
import { usePlaybackStore } from "../model/playback.store";
import { cn } from "@/shared/lib/cn";

/**
 * FollowUpInput — bottom continuation dock.
 *
 * Replaces the previous floating popup. Lives between the graph canvas
 * and the playback bar so it reads as a first-class part of the
 * conversation, not an afterthought.
 *
 * Behaviour:
 *  - Collapsed by default → renders as a calm prompt strip.
 *  - Expands on focus / click into a full composer with history.
 *  - Cmd / Ctrl + Enter submits.
 *  - On submit, switches the cycle navigator to the new follow-up.
 *
 * Shown only when the previous turn has fully completed.
 */
export default function FollowUpInput() {
    const turnStatus = useDebateStore((s) => s.turnStatus);
    const stepBusy = useDebateStore((s) => s.stepBusy);
    const stepError = useDebateStore((s) => s.stepError);
    const submitFollowUp = useDebateStore((s) => s.submitFollowUp);
    const followUps = useDebateStore(
        (s) => s.session?.latest_turn?.follow_ups ?? [],
    );
    const rounds = useDebateStore((s) => s.session?.latest_turn?.rounds ?? []);
    const originalQuestion = useDebateStore((s) => s.session?.question ?? "");
    const setSelectedCycle = usePlaybackStore((s) => s.setSelectedCycle);

    const followUpsCount = followUps.length;
    const nextFollowUpNumber = followUpsCount + 1;

    const [question, setQuestion] = useState("");
    const [expanded, setExpanded] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (expanded) {
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    }, [expanded]);

    if (turnStatus !== "completed") return null;

    const onSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const q = question.trim();
        if (!q || stepBusy) return;
        await submitFollowUp(q);
        setQuestion("");
        setExpanded(false);
        // Jump the navigator to the freshly created follow-up cycle.
        // Original debate is cycle 1, so follow-up #N is cycle N+1.
        setSelectedCycle(nextFollowUpNumber + 1);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void onSubmit();
        }
        if (e.key === "Escape") {
            setExpanded(false);
        }
    };

    return (
        <div className="border-t border-agora-border bg-agora-surface/70 backdrop-blur-sm">
            <AnimatePresence initial={false} mode="wait">
                {expanded ? (
                    <motion.div
                        key="composer"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="overflow-hidden"
                    >
                        <div className="px-6 py-4 max-w-[1200px] mx-auto">
                            <div className="flex items-start justify-between gap-4 mb-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-violet-300 font-semibold">
                                        Follow-up #{nextFollowUpNumber}
                                    </div>
                                    <h4 className="text-sm font-semibold text-white mt-0.5">
                                        Continue this debate
                                    </h4>
                                    <p className="text-[11px] text-agora-text-muted mt-0.5">
                                        The agents will respond using the previous synthesis as context.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setExpanded(false)}
                                    className="text-[11px] text-agora-text-muted hover:text-agora-text px-2 py-1"
                                >
                                    Cancel
                                </button>
                            </div>

                            <form onSubmit={onSubmit} className="space-y-2">
                                <textarea
                                    ref={textareaRef}
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    placeholder="Ask a sharper question, challenge an assumption, or pivot the discussion…"
                                    rows={4}
                                    className="w-full px-3 py-2.5 text-sm bg-agora-bg border border-agora-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/60 resize-none text-white placeholder:text-agora-text-muted/60 leading-relaxed"
                                    disabled={stepBusy}
                                />
                                {stepError && (
                                    <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2.5 py-1.5">
                                        {stepError}
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-agora-text-muted/80 tracking-wide">
                                        <kbd className="px-1.5 py-0.5 rounded bg-agora-surface-light border border-agora-border font-mono text-[10px]">
                                            ⌘ / Ctrl
                                        </kbd>
                                        {" + "}
                                        <kbd className="px-1.5 py-0.5 rounded bg-agora-surface-light border border-agora-border font-mono text-[10px]">
                                            Enter
                                        </kbd>
                                        {" to send"}
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={stepBusy || !question.trim()}
                                        className={cn(
                                            "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                                            "bg-violet-500/90 hover:bg-violet-500 text-white",
                                            "disabled:bg-agora-surface-light disabled:text-agora-text-muted disabled:cursor-not-allowed",
                                        )}
                                    >
                                        {stepBusy ? "Starting…" : "Continue Debate"}
                                    </button>
                                </div>
                            </form>

                            {followUpsCount > 0 && (
                                <div className="mt-4 pt-3 border-t border-agora-border/60">
                                    <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold mb-2">
                                        Recent follow-ups
                                    </div>
                                    <ul className="space-y-1.5 max-h-32 overflow-y-auto">
                                        {[...followUps]
                                            .sort(
                                                (a, b) =>
                                                    (b.cycle_number ?? 0) - (a.cycle_number ?? 0),
                                            )
                                            .slice(0, 4)
                                            .map((fu) => (
                                                <li
                                                    key={fu.id}
                                                    className="flex items-start gap-2 text-[11px] text-agora-text-muted"
                                                >
                                                    <span className="text-violet-300/80 font-mono">
                                                        #{(fu.cycle_number ?? 1) - 1}
                                                    </span>
                                                    <span className="line-clamp-2">{fu.question}</span>
                                                </li>
                                            ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </motion.div>
                ) : (
                    <motion.button
                        key="prompt-strip"
                        type="button"
                        onClick={() => setExpanded(true)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="w-full px-6 py-3 flex items-center gap-3 text-left hover:bg-agora-surface-light/40 transition-colors"
                    >
                        <div className="w-7 h-7 rounded-full bg-violet-500/15 border border-violet-500/40 flex items-center justify-center text-violet-300 text-sm">
                            +
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm text-agora-text">
                                Ask a follow-up question
                                {followUpsCount > 0 && (
                                    <span className="ml-2 text-[11px] text-agora-text-muted">
                                        · Will become Follow-up #{nextFollowUpNumber}
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] text-agora-text-muted/80">
                                Continue the debate without losing the existing thread.
                            </div>
                        </div>
                        <span className="text-[11px] text-agora-text-muted">↑</span>
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
}
