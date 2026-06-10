import { cn } from "@/shared/lib/cn";

export default function StatusBadge({
    children,
    tone = "neutral",
    className,
}: {
    children: React.ReactNode;
    tone?: "neutral" | "accent" | "success" | "warning" | "danger";
    className?: string;
}) {
    const tones = {
        neutral: "bg-white/8 text-white/65 border-white/10",
        accent: "bg-violet-500/15 text-violet-200 border-violet-500/25",
        success: "bg-emerald-500/12 text-emerald-300 border-emerald-500/25",
        warning: "bg-amber-500/12 text-amber-200 border-amber-500/25",
        danger: "bg-red-500/12 text-red-300 border-red-500/25",
    };

    return (
        <span className={cn(
            "h-5 inline-flex items-center justify-center rounded-full border px-2 text-[10px] font-semibold leading-none whitespace-nowrap",
            tones[tone],
            className,
        )}>
            {children}
        </span>
    );
}
