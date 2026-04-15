import { cn } from "@/shared/lib/cn";
import { useAnimationStore } from "../model/animation/animation.store";
import { useGraphStore } from "../model/graph.store";

const speeds = [0.5, 1, 1.5, 2];

export default function PlaybackBar() {
    const isPlaying = useAnimationStore((s) => s.isPlaying);
    const isPaused = useAnimationStore((s) => s.isPaused);
    const currentStep = useAnimationStore((s) => s.currentStepIndex);
    const totalSteps = useAnimationStore((s) => s.queue.length);
    const speed = useAnimationStore((s) => s.speed);
    const setSpeed = useAnimationStore((s) => s.setSpeed);
    const play = useAnimationStore((s) => s.play);
    const pause = useAnimationStore((s) => s.pause);
    const resume = useAnimationStore((s) => s.resume);
    const next = useAnimationStore((s) => s.next);
    const currentStepDescription = useAnimationStore((s) => s.currentStepDescription);
    const forceRevealAll = useGraphStore((s) => s.forceRevealAll);
    const graph = useGraphStore((s) => s.graph);

    // Fix: currentStepIndex is 0-based, so finished when index >= length - 1
    const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;
    const finished = totalSteps > 0 && currentStep >= totalSteps - 1;

    // Detect blank graph (nodes exist but all hidden)
    const hasNodes = graph.nodes.length > 0;
    const allHidden = hasNodes && graph.nodes.every((n) => n.status === "hidden");
    const noVisibleNodes = hasNodes && !graph.nodes.some((n) => n.status !== "hidden");

    const handleSkipToStatic = () => {
        useAnimationStore.getState().reset();
        forceRevealAll();
    };

    const statusLabel = finished
        ? "Debate Complete"
        : isPaused
            ? `Paused — Step ${currentStep + 1} / ${totalSteps}`
            : isPlaying
                ? `Step ${currentStep + 1} / ${totalSteps}`
                : totalSteps === 0
                    ? "Waiting for events…"
                    : currentStep < 0
                        ? `Ready — ${totalSteps} steps`
                        : `Step ${currentStep + 1} / ${totalSteps}`;

    return (
        <div className="h-14 px-6 flex items-center gap-4 border-t border-agora-border bg-agora-surface/80 backdrop-blur-sm">
            {/* Status label + step description */}
            <div className="min-w-[180px]">
                <div className="text-xs font-medium text-agora-text-muted">
                    {statusLabel}
                </div>
                {currentStepDescription && (
                    <div className="text-[10px] text-indigo-400 truncate max-w-[180px]">
                        {currentStepDescription}
                    </div>
                )}
            </div>

            {/* Progress bar */}
            <div className="flex-1 max-w-md">
                <div className="h-1.5 bg-agora-surface-light rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Controls — Next Step is primary */}
            <div className="flex items-center gap-2">
                {/* Next Step — primary action */}
                <button
                    onClick={next}
                    disabled={finished || totalSteps === 0}
                    className={cn(
                        "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        finished || totalSteps === 0
                            ? "bg-gray-700/50 text-gray-500 cursor-not-allowed"
                            : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-500/20",
                    )}
                >
                    Next Step ▸
                </button>

                {/* Play/Pause/Resume — secondary */}
                {isPlaying && !isPaused ? (
                    <button
                        onClick={pause}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-amber-600/80 text-white hover:bg-amber-500"
                    >
                        ⏸ Pause
                    </button>
                ) : isPaused ? (
                    <button
                        onClick={resume}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-agora-text-muted hover:bg-agora-surface-light hover:text-white"
                    >
                        ▶ Resume
                    </button>
                ) : !finished && totalSteps > 0 ? (
                    <button
                        onClick={play}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-agora-text-muted hover:bg-agora-surface-light hover:text-white"
                        title="Auto-play all steps"
                    >
                        ▶ Auto
                    </button>
                ) : null}

                {/* Skip to static — recovery for blank graph */}
                {(noVisibleNodes || (isPaused && allHidden)) && hasNodes && (
                    <button
                        onClick={handleSkipToStatic}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-amber-600/80 text-white hover:bg-amber-500 shadow-sm"
                        title="Skip animation and show the static graph"
                    >
                        ⏭ Show Graph
                    </button>
                )}
            </div>

            <div className="h-5 w-px bg-agora-border" />

            {/* Speed controls */}
            <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500 mr-1">Speed</span>
                {speeds.map((s) => (
                    <button
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                            speed === s
                                ? "bg-indigo-500/20 text-indigo-400"
                                : "text-gray-500 hover:text-gray-300",
                        )}
                    >
                        {s}x
                    </button>
                ))}
            </div>
        </div>
    );
}
