import { cn } from "@/shared/lib/cn";

export default function SectionCard({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("rounded-xl border border-white/10 bg-white/[0.035] p-3.5", className)}>
            {children}
        </section>
    );
}
