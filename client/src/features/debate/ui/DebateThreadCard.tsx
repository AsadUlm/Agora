import { useState } from "react";
import { cn } from "@/shared/lib/cn";
import { extractFullResponse } from "../model/formatters";

export interface AgentDisplayInfo {
    role: string;
    model?: string;
}

interface DebateThreadCardProps {
    tone: "initial" | "challenge" | "response" | "revision" | "synthesis" | "verdict";
    sourceAgent?: AgentDisplayInfo;
    targetAgent?: AgentDisplayInfo;
    relationLabel?: string;
    targetSuffix?: string;
    title?: string;
    subtitle?: string;
    summary: string;
    details?: React.ReactNode;
    fullText?: string;
    initiallyExpanded?: boolean;
    changeBadge?: string;
    changeBadgeColor?: string;
}

function getAgentStyle(role: string): { border: string; bg: string; text: string; badge: string } {
    const r = role.toLowerCase();
    if (r.includes("analyst")) {
        return {
            border: "border-l-indigo-500",
            bg: "bg-indigo-500/5 hover:bg-indigo-500/10",
            text: "text-indigo-300",
            badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
        };
    }
    if (r.includes("critic")) {
        return {
            border: "border-l-rose-500",
            bg: "bg-rose-500/5 hover:bg-rose-500/10",
            text: "text-rose-300",
            badge: "bg-rose-500/15 text-rose-300 border-rose-500/25",
        };
    }
    if (r.includes("creative") || r.includes("innov")) {
        return {
            border: "border-l-sky-500",
            bg: "bg-sky-500/5 hover:bg-sky-500/10",
            text: "text-sky-300",
            badge: "bg-sky-500/15 text-sky-300 border-sky-500/25",
        };
    }
    if (r.includes("strateg")) {
        return {
            border: "border-l-emerald-500",
            bg: "bg-emerald-500/5 hover:bg-emerald-500/10",
            text: "text-emerald-300",
            badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
        };
    }
    if (r.includes("moderator") || r.includes("synth")) {
        return {
            border: "border-l-amber-500",
            bg: "bg-amber-500/5 hover:bg-amber-500/10",
            text: "text-amber-300",
            badge: "bg-amber-500/15 text-amber-300 border-amber-500/25",
        };
    }
    return {
        border: "border-l-gray-400",
        bg: "bg-white/3 hover:bg-white/5",
        text: "text-white/85",
        badge: "bg-white/10 text-white/80 border-white/10",
    };
}

export default function DebateThreadCard({
    tone,
    sourceAgent,
    targetAgent,
    relationLabel,
    targetSuffix,
    title,
    subtitle,
    summary,
    details,
    fullText,
    initiallyExpanded = false,
    changeBadge,
    changeBadgeColor,
}: DebateThreadCardProps) {
    const [expanded, setExpanded] = useState(initiallyExpanded);

    const sourceStyle = sourceAgent ? getAgentStyle(sourceAgent.role) : null;
    const targetStyle = targetAgent ? getAgentStyle(targetAgent.role) : null;

    const baseStyle = sourceStyle ?? {
        border: "border-l-indigo-400/50",
        bg: "bg-white/3 hover:bg-white/5",
        text: "text-white/80",
        badge: "",
    };

    const toneIcons: Record<typeof tone, string> = {
        initial: "💬",
        challenge: "⚔️",
        response: "💬",
        revision: "🔄",
        synthesis: "✨",
        verdict: "🏆",
    };

    const cleanModelName = (modelName?: string) => {
        if (!modelName) return "";
        const slash = modelName.indexOf("/");
        return slash >= 0 ? modelName.slice(slash + 1) : modelName;
    };

    return (
        <div className={cn("rounded-xl border border-white/5 border-l-[3px] overflow-hidden transition-colors", baseStyle.border, baseStyle.bg)}>
            <button
                type="button"
                className="w-full text-left p-3 flex items-start gap-3"
                onClick={() => fullText && setExpanded(!expanded)}
                disabled={!fullText}
            >
                {fullText && (
                    <span className="mt-0.5 text-white/30 text-[10px] shrink-0">
                        {expanded ? "▼" : "▶"}
                    </span>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                    {/* Header: source [-> target] relationship info */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {sourceAgent && (
                            <div className="flex items-center gap-1">
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider", sourceStyle?.badge)}>
                                    {sourceAgent.role}
                                </span>
                                {sourceAgent.model && (
                                    <span className="text-[9px] text-white/35 font-mono">
                                        ({cleanModelName(sourceAgent.model)})
                                    </span>
                                )}
                            </div>
                        )}

                        {targetAgent && (
                            <>
                                <span className="text-[10px] text-white/40 font-medium">
                                    {relationLabel ?? (tone === "challenge" ? "challenged" : tone === "response" ? "responded to" : "→")}
                                </span>
                                <div className="flex items-center gap-1">
                                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider", targetStyle?.badge)}>
                                        {targetAgent.role}{targetSuffix}
                                    </span>
                                    {targetAgent.model && (
                                        <span className="text-[9px] text-white/35 font-mono">
                                            ({cleanModelName(targetAgent.model)})
                                        </span>
                                    )}
                                </div>
                            </>
                        )}

                        {title && !sourceAgent && (
                            <span className="text-[10px] font-semibold text-white/80 uppercase tracking-wider">
                                {title}
                            </span>
                        )}

                        {/* Change type badge (specifically for revised positions) */}
                        {changeBadge && (
                            <span className={cn("ml-auto text-[9px] font-medium px-1.5 py-0.5 rounded-full border", changeBadgeColor ?? "bg-white/10 text-white/50 border-white/15")}>
                                {changeBadge}
                            </span>
                        )}

                        <span className={cn("text-xs", !changeBadge && "ml-auto")} title={`${tone} step`}>
                            {toneIcons[tone]}
                        </span>
                    </div>

                    {/* Stance / subtitle */}
                    {subtitle && (
                        <p className="text-[11px] text-amber-200/75 italic leading-snug break-words">
                            "{subtitle}"
                        </p>
                    )}

                    {/* Summary */}
                    {summary && (!expanded || !fullText) && (
                        <p className="text-xs text-white/70 leading-relaxed break-words">
                            {summary}
                        </p>
                    )}

                    {/* Expandable details when expanded */}
                    {expanded && details && (
                        <div className="pt-1.5 border-t border-white/5 mt-1 space-y-2.5">
                            {details}
                        </div>
                    )}

                    {/* Instruction to read full text */}
                    {fullText && !expanded && (
                        <p className="text-[9px] text-indigo-400 hover:text-indigo-300 font-medium mt-1">
                            Show full response
                        </p>
                    )}
                </div>
            </button>

            {/* Fenced full text section when expanded */}
            {expanded && fullText && (
                <div className="px-4 pb-4 pt-1.5 border-t border-white/5 bg-black/10">
                    <p className="text-[10px] text-indigo-400 uppercase tracking-wider font-semibold mb-1">
                        Full Response
                    </p>
                    <p className="text-xs text-white/80 leading-relaxed whitespace-pre-wrap break-words font-sans">
                        {extractFullResponse(fullText)}
                    </p>
                </div>
            )}
        </div>
    );
}
