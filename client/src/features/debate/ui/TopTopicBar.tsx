import { cn } from "@/shared/lib/cn";
import { useDebateStore } from "../model/debate.store";

export default function TopTopicBar() {
    const session = useDebateStore((s) => s.session);
    const turnStatus = useDebateStore((s) => s.turnStatus);

    const statusColor: Record<string, string> = {
        queued: "bg-amber-500/20 text-amber-400 border-amber-500/30",
        running: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
        completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        failed: "bg-red-500/20 text-red-400 border-red-500/30",
    };

    return (
        <div className="h-14 px-6 flex items-center justify-between border-b border-agora-border bg-agora-surface/80 backdrop-blur-sm">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                        A
                    </div>
                    <span className="text-sm font-semibold text-white">AGORA</span>
                </div>

                <div className="h-5 w-px bg-agora-border" />

                <div className="text-sm text-agora-text-muted truncate max-w-[500px]">
                    {session?.question ?? "No debate loaded"}
                </div>
            </div>

            <div className="flex items-center gap-3">
                {turnStatus && (
                    <span
                        className={cn(
                            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border uppercase tracking-wider",
                            statusColor[turnStatus] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30",
                        )}
                    >
                        {turnStatus === "running" && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5 animate-pulse" />
                        )}
                        {turnStatus}
                    </span>
                )}

                {session?.agents && (
                    <span className="text-[11px] text-agora-text-muted">
                        {session.agents.length} agents
                    </span>
                )}
            </div>
        </div>
    );
}
