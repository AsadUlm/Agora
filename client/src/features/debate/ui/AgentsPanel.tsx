/**
 * AgentsPanel — Step 27.1.
 *
 * Lists every agent participating in the current debate so the user can
 * inspect persona, model, provider and temperature at a glance. Sourced
 * from `useDebateStore(s => s.agents)` which is hydrated from the
 * `SessionDetailDTO.agents` returned by the backend (already exposes
 * `model`, `provider`, `temperature`, `role` etc. — no backend change
 * needed).
 */

import { useDebateStore } from "../model/debate.store";
import { getPersonaMeta } from "../model/persona-meta";
import { cn } from "@/shared/lib/cn";

function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatModel(model: string | null | undefined): string {
    if (!model) return "Not specified";
    // Strip provider prefix if present, e.g. "anthropic/claude-sonnet-4.5".
    const slash = model.indexOf("/");
    return slash >= 0 ? model.slice(slash + 1) : model;
}

function formatProvider(provider: string | null | undefined): string {
    if (!provider) return "Unknown";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function AgentsPanel() {
    const agents = useDebateStore((s) => s.agents);

    if (!agents || agents.length === 0) {
        return (
            <div className="h-full flex items-center justify-center px-6 text-center">
                <p className="text-xs text-agora-text-muted">
                    No agent metadata is available for this debate yet.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto px-3 py-3 space-y-2.5">
            <div className="px-1 mb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-agora-text-muted font-semibold">
                    Active agents
                </div>
                <div className="text-[10px] text-agora-text-muted/70">{agents.length}</div>
            </div>

            {agents.map((a) => {
                const persona = getPersonaMeta(a.role);
                const role = capitalize(a.role || "Agent");
                return (
                    <div
                        key={a.id}
                        className="rounded-lg border border-agora-border bg-agora-surface-light/30 px-3 py-2.5 space-y-2"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-white leading-tight truncate">
                                    {role}
                                </div>
                                {persona && (
                                    <div
                                        className={cn(
                                            "mt-0.5 text-[11px] font-medium",
                                            persona.accentText,
                                        )}
                                    >
                                        {persona.title}
                                    </div>
                                )}
                            </div>
                            {persona && (
                                <span
                                    className={cn(
                                        "shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                                        persona.accentChip,
                                        persona.accentText,
                                    )}
                                    title="Persona archetype"
                                >
                                    {persona.title.split(" ")[0]}
                                </span>
                            )}
                        </div>

                        {persona && (
                            <p className="text-[11px] text-agora-text-muted leading-snug">
                                {persona.style}
                            </p>
                        )}

                        <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[11px]">
                            <dt className="text-agora-text-muted">Model</dt>
                            <dd
                                className="text-agora-text font-mono text-[10.5px] truncate"
                                title={a.model ?? undefined}
                            >
                                {formatModel(a.model)}
                            </dd>

                            <dt className="text-agora-text-muted">Provider</dt>
                            <dd className="text-agora-text">{formatProvider(a.provider)}</dd>

                            <dt className="text-agora-text-muted">Temperature</dt>
                            <dd className="text-agora-text">
                                {a.temperature == null ? (
                                    <span className="text-agora-text-muted/80">Default</span>
                                ) : (
                                    a.temperature.toFixed(2)
                                )}
                            </dd>

                            {a.reasoning_style && (
                                <>
                                    <dt className="text-agora-text-muted">Style</dt>
                                    <dd className="text-agora-text capitalize">
                                        {a.reasoning_style.replace(/_/g, " ")}
                                    </dd>
                                </>
                            )}

                            {a.knowledge_mode && a.knowledge_mode !== "no_docs" && (
                                <>
                                    <dt className="text-agora-text-muted">Docs</dt>
                                    <dd className="text-agora-text">
                                        {a.knowledge_mode.replace(/_/g, " ")}
                                        {a.document_ids && a.document_ids.length > 0 && (
                                            <span className="ml-1 text-agora-text-muted">
                                                ({a.document_ids.length})
                                            </span>
                                        )}
                                    </dd>
                                </>
                            )}
                        </dl>
                    </div>
                );
            })}

            <p className="text-[10px] text-agora-text-muted/60 italic px-1 pt-2">
                Persona archetypes drive base temperature and prompt style on the server.
            </p>
        </div>
    );
}
