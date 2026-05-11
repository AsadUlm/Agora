import { useState } from "react";
import { useDebateStore } from "../model/debate.store";

/**
 * FollowUpInput
 *
 * Renders an inline composer that lets the user ask a follow-up question
 * after the initial debate has completed. Posting the question opens a new
 * debate cycle on the same chat session/turn (no graph reset, no new
 * session, no UI block).
 */
export default function FollowUpInput() {
    const turnStatus = useDebateStore((s) => s.turnStatus);
    const stepBusy = useDebateStore((s) => s.stepBusy);
    const stepError = useDebateStore((s) => s.stepError);
    const submitFollowUp = useDebateStore((s) => s.submitFollowUp);
    const followUpsCount = useDebateStore(
        (s) => s.session?.latest_turn?.follow_ups?.length ?? 0,
    );
    const nextFollowUpNumber = followUpsCount + 1;

    const [question, setQuestion] = useState("");
    const [open, setOpen] = useState(false);

    if (turnStatus !== "completed") return null;

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const q = question.trim();
        if (!q || stepBusy) return;
        await submitFollowUp(q);
        setQuestion("");
        setOpen(false);
    };

    if (!open) {
        return (
            <div className="absolute bottom-24 right-6 z-30">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="px-4 py-2 rounded-full bg-agora-accent text-white shadow-lg hover:opacity-90 transition"
                >
                    Continue Debate{followUpsCount > 0 ? ` · Follow-up #${nextFollowUpNumber}` : ""}
                </button>
            </div>
        );
    }

    return (
        <div className="absolute bottom-24 right-6 z-30 w-[380px] max-w-[90vw] bg-agora-surface border border-agora-border rounded-xl shadow-xl p-4">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-agora-accent font-semibold">
                        Follow-up #{nextFollowUpNumber}
                    </div>
                    <h4 className="text-sm font-medium text-agora-text">
                        Ask a follow-up question
                    </h4>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs text-agora-text-muted hover:text-agora-text"
                >
                    Close
                </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-2">
                <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. How does this apply to a different jurisdiction?"
                    rows={3}
                    className="w-full px-3 py-2 text-sm bg-agora-bg border border-agora-border rounded-md focus:outline-none focus:ring-2 focus:ring-agora-accent resize-none"
                    disabled={stepBusy}
                />
                {stepError && (
                    <div className="text-xs text-red-400">{stepError}</div>
                )}
                <div className="flex justify-end gap-2">
                    <button
                        type="submit"
                        disabled={stepBusy || !question.trim()}
                        className="px-3 py-1.5 text-sm rounded-md bg-agora-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                    >
                        {stepBusy ? "Starting…" : "Continue Debate"}
                    </button>
                </div>
            </form>
        </div>
    );
}
