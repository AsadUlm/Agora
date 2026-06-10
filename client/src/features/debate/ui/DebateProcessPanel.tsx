import { useEffect, useRef } from "react";
import { useDebateStore } from "../model/debate.store";
import { buildDebateProcessModel } from "../model/debate-process.selectors";
import { useDebateFocusStore, resolveProcessAnchorId } from "../model/debate-focus.store";
import DebateThreadView from "./DebateThreadView";
import { usePlaybackStore } from "../model/playback.store";

/**
 * Injects a brief focus-highlight style into the document once.
 * We do this in JS to avoid requiring a global CSS import.
 */
const HIGHLIGHT_CLASS = "process-focus-highlight";

function ensureHighlightStyle() {
    if (document.getElementById("__process-highlight-style")) return;
    const style = document.createElement("style");
    style.id = "__process-highlight-style";
    style.textContent = `
        .${HIGHLIGHT_CLASS} {
            outline: 2px solid rgba(139, 92, 246, 0.95) !important;
            box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.18) !important;
            border-radius: 12px;
            transition: box-shadow 200ms ease, outline 200ms ease;
        }
    `;
    document.head.appendChild(style);
}

export default function DebateProcessPanel() {
    const session = useDebateStore((s) => s.session);
    const selectedCycle = usePlaybackStore((s) => s.selectedCycle);
    const processModel = buildDebateProcessModel(session, selectedCycle);
    const focusTarget = useDebateFocusStore((s) => s.focusTarget);
    const clearFocusTarget = useDebateFocusStore((s) => s.clearFocusTarget);
    const prevFocusRef = useRef<typeof focusTarget>(null);

    // Inject highlight CSS once
    useEffect(() => {
        ensureHighlightStyle();
    }, []);

    // Scroll to and highlight the matching card when focusTarget changes
    useEffect(() => {
        if (!focusTarget) return;
        // Skip if the target didn't actually change (prevent double-trigger)
        const prev = prevFocusRef.current;
        if (
            prev &&
            JSON.stringify(prev) === JSON.stringify(focusTarget)
        ) return;
        prevFocusRef.current = focusTarget;

        const anchorId = resolveProcessAnchorId(focusTarget);

        // Small delay to let the tab switch + render settle
        const timer = setTimeout(() => {
            const el = document.getElementById(anchorId);
            if (!el) return;

            el.scrollIntoView({ behavior: "smooth", block: "center" });

            // Brief purple outline highlight
            el.classList.add(HIGHLIGHT_CLASS);
            const removeTimer = setTimeout(() => {
                el.classList.remove(HIGHLIGHT_CLASS);
            }, 1800);

            return () => clearTimeout(removeTimer);
        }, 100);

        return () => clearTimeout(timer);
    }, [focusTarget, clearFocusTarget]);

    if (!session?.latest_turn) {
        return (
            <div className="py-12 text-center text-xs text-white/30 italic">
                Debate data will appear here once the debate completes.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <DebateThreadView process={processModel} />
        </div>
    );
}
