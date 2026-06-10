/**
 * Agent Preset — shared types & helpers.
 *
 * A preset is a reusable template for an agent configuration. The backend
 * exposes both built-in (system) presets and user-saved presets through a
 * single endpoint; the type discriminator is the `type` field.
 */

import type {
    AgentConfig,
    KnowledgeMode,
    ModelPresetKey,
} from "@/features/debate/model/agent-config.types";

export type AgentPresetType = "system" | "user";
export type AgentPresetVisibility = "private" | "shared" | "system";

// Backend keeps the same RAG-mode tokens as ChatAgent.knowledge_mode.
export type AgentRagMode = KnowledgeMode;

export interface AgentPreset {
    id: string;
    user_id?: string | null;
    is_system?: boolean;
    system_key?: string | null;

    name: string;
    description?: string | null;

    type: AgentPresetType;
    visibility: AgentPresetVisibility;

    role_description: string;
    reasoning_style: string;
    reasoning_depth: string;

    provider: string;
    model: string;
    model_preset?: string | null;
    temperature: number;

    rag_mode: AgentRagMode;
    document_ids: string[];
    strict_grounding: boolean;

    is_default?: boolean;
    is_archived?: boolean;

    created_at?: string | null;
    updated_at?: string | null;
}

export interface AgentPresetCreatePayload {
    name: string;
    description?: string | null;
    role_description: string;
    reasoning_style: string;
    reasoning_depth: string;
    provider: string;
    model: string;
    model_preset?: string | null;
    temperature: number;
    rag_mode: AgentRagMode;
    document_ids: string[];
    strict_grounding: boolean;
    is_default?: boolean;
}

export type AgentPresetUpdatePayload = Partial<AgentPresetCreatePayload> & {
    is_archived?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function isSystemPreset(preset: AgentPreset | null | undefined): boolean {
    return !!preset && (preset.type === "system" || preset.is_system === true);
}

export function isUserPreset(preset: AgentPreset | null | undefined): boolean {
    return !!preset && preset.type === "user";
}

/**
 * Apply preset values to an agent config draft. Does NOT mutate the
 * agent's user-customised `role` name (we keep what the user typed
 * already, unless it is still the placeholder/default).
 */
export function applyPresetToAgentConfig(
    preset: AgentPreset,
    current: AgentConfig,
    options: { overrideRole?: boolean } = {},
): Partial<AgentConfig> {
    const updates: Partial<AgentConfig> = {
        preset: preset.id,
        roleDescription: preset.role_description,
        reasoningStyle: preset.reasoning_style,
        reasoningDepth: preset.reasoning_depth,
        provider: preset.provider,
        model: preset.model,
        modelPreset: (preset.model_preset as ModelPresetKey | null) ?? null,
        temperature: preset.temperature,
        knowledgeMode: preset.rag_mode,
        knowledgeStrict: preset.strict_grounding,
        documentIds: preset.rag_mode === "assigned_docs_only"
            ? [...(preset.document_ids ?? [])]
            : current.documentIds,
    };

    const looksLikeUntouchedRole =
        !current.role ||
        current.role === "agent" ||
        current.role === "analyst" ||
        current.role === "critic" ||
        current.role === "creative";

    if (options.overrideRole || looksLikeUntouchedRole) {
        updates.role = preset.name;
    }

    return updates;
}

/** Returns true if the agent's relevant fields differ from the preset's. */
export function hasPresetChanges(
    preset: AgentPreset,
    current: AgentConfig,
): boolean {
    if (current.preset !== preset.id) return true;
    if ((current.roleDescription ?? "") !== (preset.role_description ?? "")) return true;
    if (current.reasoningStyle !== preset.reasoning_style) return true;
    if (current.reasoningDepth !== preset.reasoning_depth) return true;
    if (current.provider !== preset.provider) return true;
    if (current.model !== preset.model) return true;
    if ((current.modelPreset ?? null) !== (preset.model_preset ?? null)) return true;
    if (Math.abs(current.temperature - preset.temperature) > 0.001) return true;
    if (current.knowledgeMode !== preset.rag_mode) return true;
    if (current.knowledgeStrict !== preset.strict_grounding) return true;
    if (preset.rag_mode === "assigned_docs_only") {
        const a = [...(current.documentIds ?? [])].sort().join("|");
        const b = [...(preset.document_ids ?? [])].sort().join("|");
        if (a !== b) return true;
    }
    return false;
}

/** Build a creation payload from a debate-draft agent config. */
export function createPresetFromAgentConfig(
    agent: AgentConfig,
    name: string,
    description?: string,
): AgentPresetCreatePayload {
    return {
        name: name.trim(),
        description: description?.trim() || null,
        role_description: agent.roleDescription ?? "",
        reasoning_style: agent.reasoningStyle,
        reasoning_depth: agent.reasoningDepth,
        provider: agent.provider,
        model: agent.model,
        model_preset: agent.modelPreset ?? null,
        temperature: agent.temperature,
        rag_mode: agent.knowledgeMode,
        document_ids: agent.knowledgeMode === "assigned_docs_only"
            ? [...(agent.documentIds ?? [])]
            : [],
        strict_grounding: agent.knowledgeStrict,
    };
}
