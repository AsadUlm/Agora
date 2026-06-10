import { cn } from "@/shared/lib/cn";

export default function AgentBadge({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span className={cn(
            "h-5 inline-flex items-center rounded-md border border-violet-500/25 bg-violet-500/12 px-2 text-[10px] font-semibold uppercase tracking-wide text-violet-200",
            className,
        )}>
            {children}
        </span>
    );
}
