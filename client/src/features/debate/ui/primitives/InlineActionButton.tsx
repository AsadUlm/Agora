import { cn } from "@/shared/lib/cn";

export default function InlineActionButton({
    children,
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={cn(
                "min-h-7 inline-flex items-center gap-1 py-1 text-left text-xs font-semibold text-violet-300 hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 rounded",
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}
