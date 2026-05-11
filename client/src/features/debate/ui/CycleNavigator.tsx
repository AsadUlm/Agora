import { useMemo } from "react";
import { motion } from "motion/react";
import { cn } from "@/shared/lib/cn";
import { useGraphStore } from "../model/graph.store";
import { useDebateStore } from "../model/debate.store";
import { usePlaybackStore } from "../model/playback.store";

const _STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how",
    "if", "in", "is", "it", "of", "on", "or", "should", "than", "that", "the",
    "to", "was", "we", "what", "when", "where", "which", "why", "will", "with",
    "would", "you", "your", "this", "these", "those", "but", "not", "have",
    "has", "had", "can", "could", "may", "might", "ought", "must", "about",
    "into", "over", "under", "again", "then", "there", "their", "them", "i",
    "me", "my", "us", "our", "they", "do", "does",
]);

/**
 * Auto-generate a short semantic title from a free-form question.
 * Picks 2–4 capitalized content words; falls back to truncated question.
 */
function semanticTitle(question: string, maxWords = 4): string {
    const text = (question || "").trim();
    if (!text) return "Follow-up";
    // Strip leading "what if", "how would", etc.
    const cleaned = text
        .replace(/^[\s"'`]+/, "")
        .replace(/[?!.]+\s*$/, "")
        .replace(/^(what (if|about|happens?)|how (do|does|would|could|might)|why (do|does|would|should)|should|could|would|when|where|which|who)\b\s*/i, "");

    // Tokenize and take meaningful words.
    const tokens = cleaned
        .split(/[^a-zA-Z0-9'-]+/)
        .filter((w) => w && w.length > 2 && !_STOPWORDS.has(w.toLowerCase()));
    const picked = tokens.slice(0, maxWords);
    if (picked.length === 0) {
        return cleaned.length > 40 ? cleaned.slice(0, 37).trim() + "…" : cleaned;
    }
    // Title-case selected words.
    return picked
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/**
 * Lists every cycle in the current debate (Original + each Follow-up)
 * and lets the user switch the graph view between them.
 *
 * Designed for the left sidebar — sits above the round timeline and
 * acts as the *outer* navigation level (cycle → round → node).
 */
export default function CycleNavigator() {
    const graph = useGraphStore((s) => s.graph);
    const session = useDebateStore((s) => s.session);
    const selectedCycle = usePlaybackStore((s) => s.selectedCycle);
    const setSelectedCycle = usePlaybackStore((s) => s.setSelectedCycle);
    const selectNode = useGraphStore((s) => s.selectNode);
    const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

    /**
     * User-driven cycle switch. Clears any selected node so the moderator
     * panel and node detail drawer do not display stale content from
     * another cycle.
     */
    const handleCycleClick = (cycle: number) => {
        if (cycle === selectedCycle) return;
        setSelectedCycle(cycle);
        if (selectedNodeId) selectNode(null);
    };

    const cycles = useMemo(() => {
        const set = new Set<number>([1]);
        for (const n of graph.nodes) {
            if (n.cycle && n.cycle >= 1) set.add(n.cycle);
        }
        return Array.from(set).sort((a, b) => a - b);
    }, [graph.nodes]);

    // Map each cycle to a short user-facing label.
    const followUps = session?.latest_turn?.follow_ups ?? [];

    if (cycles.length <= 1) {
        // Only the original debate — collapse the navigator to a slim header
        // so the sidebar doesn't feel padded with empty chrome.
        return (
            <div className="px-4 py-3 border-b border-agora-border">
                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Debate Cycle
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                    Original Debate
                </div>
            </div>
        );
    }

    return (
        <div className="px-3 py-3 border-b border-agora-border space-y-1.5">
            <div className="px-1 mb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Debate Cycles
                </div>
                <div className="text-[10px] text-agora-text-muted/70">
                    {cycles.length}
                </div>
            </div>

            {cycles.map((cycle, idx) => {
                const isSelected = cycle === selectedCycle;
                const isOriginal = cycle === 1;
                const followUp = isOriginal ? null : followUps[cycle - 2] ?? null;
                const label = isOriginal
                    ? "Original Debate"
                    : `Follow-up #${cycle - 1}`;
                const semantic = isOriginal
                    ? null
                    : semanticTitle(followUp?.question ?? "");
                const subtitle = isOriginal
                    ? session?.question
                    : followUp?.question ?? "User follow-up";

                return (
                    <motion.button
                        key={cycle}
                        type="button"
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.04 }}
                        onClick={() => handleCycleClick(cycle)}
                        className={cn(
                            "w-full text-left px-3 py-2 rounded-lg transition-all duration-200 border",
                            isSelected
                                ? "bg-violet-500/15 border-violet-400/40 shadow-md shadow-violet-900/20"
                                : "bg-agora-surface-light/30 border-transparent hover:bg-agora-surface-light/60 hover:border-agora-border",
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className={cn(
                                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                                    isSelected ? "bg-violet-300" : "bg-agora-text-muted/40",
                                )}
                            />
                            <div
                                className={cn(
                                    "text-[11px] font-semibold tracking-wide",
                                    isSelected ? "text-violet-100" : "text-agora-text",
                                )}
                            >
                                {label}
                            </div>
                            {semantic && (
                                <div
                                    className={cn(
                                        "ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-md border truncate max-w-[55%]",
                                        isSelected
                                            ? "bg-violet-500/20 text-violet-100 border-violet-400/40"
                                            : "bg-agora-surface-light/60 text-agora-text-muted border-agora-border",
                                    )}
                                    title={semantic}
                                >
                                    {semantic}
                                </div>
                            )}
                        </div>
                        {subtitle && (
                            <div
                                className="mt-1 text-[11px] text-agora-text-muted line-clamp-2 leading-snug"
                                title={subtitle}
                            >
                                {subtitle}
                            </div>
                        )}
                    </motion.button>
                );
            })}
        </div>
    );
}
