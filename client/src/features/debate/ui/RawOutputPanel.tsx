/**
 * RawOutputPanel — Step 27.
 * Shows the latest turn's raw payloads for debugging / advanced inspection.
 */
import { useMemo, useState } from "react";
import { useDebateStore } from "../model/debate.store";
import { cn } from "@/shared/lib/cn";

export default function RawOutputPanel() {
    const turn = useDebateStore((s) => s.session?.latest_turn ?? null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const payload = useMemo(() => turn, [turn]);
    if (!payload) {
        return (
            <div className="w-full h-full bg-agora-surface/40 p-4 text-xs text-agora-text-muted">
                Raw output will appear once a debate is loaded.
            </div>
        );
    }

    const toggle = (id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="w-full h-full bg-agora-surface/40 flex flex-col">
            <div className="px-4 py-3 border-b border-agora-border">
                <h2 className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Raw Output
                </h2>
                <p className="text-[11px] text-agora-text-muted/80 mt-0.5">
                    Structured payloads from each round.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                {(payload.rounds ?? []).map((r) => {
                    const id = r.id;
                    const open = expanded.has(id);
                    return (
                        <div key={id} className="rounded-md border border-agora-border bg-agora-surface-light/30">
                            <button
                                type="button"
                                onClick={() => toggle(id)}
                                className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-agora-surface-light/50 transition-colors"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[11px] font-semibold text-white">
                                        Round {r.round_number}
                                    </span>
                                    <span className="text-[10px] text-agora-text-muted uppercase tracking-wide">
                                        {r.round_type}
                                    </span>
                                    {r.cycle_number && r.cycle_number > 1 && (
                                        <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 border border-violet-500/30 text-[9px]">
                                            cycle {r.cycle_number}
                                        </span>
                                    )}
                                </div>
                                <span className={cn("text-[10px] text-agora-text-muted", open && "rotate-90")}>▶</span>
                            </button>
                            {open && (
                                <div className="px-3 pb-3 space-y-2">
                                    {r.messages.map((m) => (
                                        <details key={m.id} className="rounded bg-agora-bg/40 border border-agora-border">
                                            <summary className="px-2 py-1.5 cursor-pointer text-[10px] text-agora-text-muted">
                                                {m.agent_role ?? "system"} · seq {m.sequence_no}
                                            </summary>
                                            <pre className="px-2 pb-2 pt-0 text-[10px] text-agora-text-muted overflow-x-auto whitespace-pre-wrap break-words">
                                                {JSON.stringify(m.payload ?? {}, null, 2)}
                                            </pre>
                                        </details>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
