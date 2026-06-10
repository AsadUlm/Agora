import React from "react";
import { cn } from "@/shared/lib/cn";
import type { DebateStageStatus } from "../model/debate-process.selectors";
import StatusBadge from "./primitives/StatusBadge";

interface DebateRoundSectionProps {
    title: string;
    subtitle?: string;
    status?: DebateStageStatus;
    children: React.ReactNode;
}

export default function DebateRoundSection({
    title,
    subtitle,
    status = "idle",
    children,
}: DebateRoundSectionProps) {
    const statusConfig: Record<DebateStageStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger"; classes?: string }> = {
        idle: { label: "Pending", tone: "neutral" },
        queued: { label: "Queued", tone: "warning" },
        running: { label: "In Progress", tone: "accent", classes: "animate-pulse" },
        completed: { label: "Completed", tone: "success" },
        partially_completed: { label: "Partial", tone: "warning" },
        failed: { label: "Failed", tone: "danger" },
    };

    const cfg = statusConfig[status] || statusConfig.idle;

    return (
        <section className="rounded-xl border border-white/5 bg-white/2 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-sm font-semibold text-white tracking-wide uppercase">
                        {title}
                    </h2>
                    {subtitle && (
                        <p className="text-[11px] text-white/45 mt-0.5 leading-relaxed">
                            {subtitle}
                        </p>
                    )}
                </div>
                {status !== "idle" && (
                    <StatusBadge tone={cfg.tone} className={cn("uppercase tracking-wider", cfg.classes)}>
                        {cfg.label}
                    </StatusBadge>
                )}
            </div>
            <div className="space-y-3 pt-1">
                {children}
            </div>
        </section>
    );
}
