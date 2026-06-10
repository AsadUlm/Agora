import { cn } from "@/shared/lib/cn";

export interface PanelTab<T extends string> {
    id: T;
    label: string;
    icon?: React.ReactNode;
    badge?: string | number;
}

export default function PanelTabs<T extends string>({
    tabs,
    activeTab,
    onChange,
}: {
    tabs: PanelTab<T>[];
    activeTab: T;
    onChange: (tab: T) => void;
}) {
    return (
        <div className="flex items-center gap-1 overflow-x-auto p-2 border-b border-agora-border bg-agora-bg/45">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={cn(
                        "h-11 lg:h-9 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
                        activeTab === tab.id
                            ? "bg-violet-600 text-white shadow-sm shadow-violet-950/40"
                            : "text-agora-text-muted hover:bg-white/8 hover:text-white",
                    )}
                    aria-pressed={activeTab === tab.id}
                >
                    {tab.icon && <span className="inline-flex items-center justify-center opacity-90">{tab.icon}</span>}
                    <span>{tab.label}</span>
                    {tab.badge !== undefined && (
                        <span className={cn(
                            "min-w-4.5 h-4.5 px-1 rounded-full inline-flex items-center justify-center text-[10px] font-bold leading-none",
                            activeTab === tab.id ? "bg-white/20 text-white" : "bg-violet-500/20 text-violet-200",
                        )}>
                            {tab.badge}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}
