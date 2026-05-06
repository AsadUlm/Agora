/**
 * Agent Configuration Types — draft state for debate creation.
 */

export type KnowledgeMode = "no_docs" | "shared_session_docs" | "assigned_docs_only";
export type ModelPresetKey = "fast" | "balanced" | "high_quality";

export interface AgentConfig {
    /** Client-side ID for key management */
    _id: string;
    /** Role label (e.g., "analyst", "critic", "creative") */
    role: string;
    /** Role description / mission for the agent */
    roleDescription: string;
    /** Reasoning style (e.g., "analytical", "creative", "balanced") */
    reasoningStyle: string;
    /** Reasoning depth */
    reasoningDepth: string;
    /** LLM provider */
    provider: string;
    /** Model name */
    model: string;
    /** Model quality/speed preset */
    modelPreset: ModelPresetKey | null;
    /** Temperature (0–2) */
    temperature: number;
    /** Whether this agent participates */
    enabled: boolean;
    /** Knowledge mode */
    knowledgeMode: KnowledgeMode;
    /** Strict grounding — only use docs, no general knowledge */
    knowledgeStrict: boolean;
    /** Document IDs assigned to this agent (for assigned_docs_only mode) */
    documentIds: string[];
    /** Custom instruction for the agent */
    customInstruction: string;
    /** Preset key (null = fully custom) */
    preset: string | null;
}

export interface AgentPreset {
    key: string;
    label: string;
    role: string;
    roleDescription: string;
    reasoningStyle: string;
    reasoningDepth: string;
    knowledgeMode: KnowledgeMode;
    knowledgeStrict: boolean;
}

export interface ModelPreset {
    key: ModelPresetKey;
    label: string;
    provider: string;
    model: string;
    temperature: number;
}

export const MODEL_PRESETS: ModelPreset[] = [
    {
        key: "fast",
        label: "Fast",
        provider: "openrouter",
        model: "x-ai/grok-4.1-fast",
        temperature: 0.6,
    },
    {
        key: "balanced",
        label: "Balanced",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.7,
    },
    {
        key: "high_quality",
        label: "High Quality",
        provider: "openrouter",
        model: "openai/gpt-5.5",
        temperature: 0.5,
    },
];

export const AGENT_PRESETS: AgentPreset[] = [
    {
        key: "human_rights_advocate",
        label: "Human Rights Advocate",
        role: "Human Rights Advocate",
        roleDescription: "Argues from human rights, dignity, and ethical principles perspective.",
        reasoningStyle: "balanced",
        reasoningDepth: "deep",
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
    },
    {
        key: "security_strategist",
        label: "Security Strategist",
        role: "Security Strategist",
        roleDescription: "Focuses on security, risk assessment, and strategic defense perspectives.",
        reasoningStyle: "analytical",
        reasoningDepth: "deep",
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
    },
    {
        key: "policy_maker",
        label: "Policy Maker",
        role: "Policy Maker",
        roleDescription: "Evaluates issues from regulatory, governance, and practical implementation standpoints.",
        reasoningStyle: "balanced",
        reasoningDepth: "normal",
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
    },
    {
        key: "ethicist",
        label: "Ethicist",
        role: "Ethicist",
        roleDescription: "Analyzes moral dimensions, ethical frameworks, and philosophical implications.",
        reasoningStyle: "analytical",
        reasoningDepth: "deep",
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
    },
    {
        key: "devils_advocate",
        label: "Devil's Advocate",
        role: "Devil's Advocate",
        roleDescription: "Intentionally challenges prevailing arguments to test their strength.",
        reasoningStyle: "devil's advocate",
        reasoningDepth: "normal",
        knowledgeMode: "no_docs",
        knowledgeStrict: false,
    },
    {
        key: "knowledge_expert",
        label: "Knowledge Expert",
        role: "Knowledge Expert",
        roleDescription: "Grounds arguments exclusively in provided documents and evidence.",
        reasoningStyle: "analytical",
        reasoningDepth: "deep",
        knowledgeMode: "assigned_docs_only",
        knowledgeStrict: true,
    },
];

export const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
    {
        _id: "default-1",
        role: "analyst",
        roleDescription: "",
        reasoningStyle: "analytical",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        modelPreset: "balanced",
        temperature: 0.7,
        enabled: true,
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
    },
    {
        _id: "default-2",
        role: "critic",
        roleDescription: "",
        reasoningStyle: "critical",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "x-ai/grok-4.1-fast",
        modelPreset: "fast",
        temperature: 0.6,
        enabled: true,
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
    },
    {
        _id: "default-3",
        role: "creative",
        roleDescription: "",
        reasoningStyle: "creative",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "openai/gpt-5.5",
        modelPreset: "high_quality",
        temperature: 0.5,
        enabled: true,
        knowledgeMode: "no_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
    },
];

export const PROVIDER_OPTIONS = ["openrouter"] as const;

/**
 * Static fallback catalog. The authoritative source is the backend
 * `/llm/providers` endpoint (see `llmCatalogService`); these lists keep
 * the UI usable even if the catalog hasn't loaded yet.
 */
export const MODEL_OPTIONS: Record<string, string[]> = {
    openrouter: [
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-haiku-4.5",
        "openai/gpt-5.5",
        "openai/gpt-4.1-mini",
        "deepseek/deepseek-v3.2",
        "x-ai/grok-4.1-fast",
        "x-ai/grok-4",
        "moonshotai/kimi-k2.5",
    ],
};

export const REASONING_STYLES = [
    "analytical",
    "creative",
    "critical",
    "balanced",
    "socratic",
    "devil's advocate",
] as const;

export const REASONING_DEPTHS = ["shallow", "normal", "deep"] as const;

export const KNOWLEDGE_MODES: { value: KnowledgeMode; label: string; description: string }[] = [
    { value: "no_docs", label: "No documents", description: "Agent relies entirely on reasoning" },
    { value: "shared_session_docs", label: "Shared session docs", description: "Uses all session documents" },
    { value: "assigned_docs_only", label: "Assigned docs only", description: "Uses only selected documents" },
];

/**
 * Convert AgentConfig[] to the backend-expected agents payload.
 */
export function agentConfigsToPayload(
    configs: AgentConfig[],
): { role: string; config: Record<string, unknown>; document_ids: string[] }[] {
    return configs
        .filter((c) => c.enabled)
        .map((c) => ({
            role: c.role,
            config: {
                identity: {
                    name: c.role,
                    description: c.roleDescription,
                },
                model: {
                    provider: c.provider,
                    model: c.model,
                    temperature: c.temperature,
                },
                reasoning: {
                    style: c.reasoningStyle,
                    depth: c.reasoningDepth,
                },
                knowledge: {
                    mode: c.knowledgeMode,
                    strict: c.knowledgeStrict,
                },
            },
            document_ids: c.knowledgeMode === "assigned_docs_only" ? c.documentIds : [],
        }));
}

let _nextId = 100;
export function createAgentConfig(partial?: Partial<AgentConfig>): AgentConfig {
    return {
        _id: `agent-${++_nextId}`,
        role: "agent",
        roleDescription: "",
        reasoningStyle: "balanced",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        modelPreset: "balanced",
        temperature: 0.7,
        enabled: true,
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
        ...partial,
    };
}

export function createAgentFromPreset(preset: AgentPreset): AgentConfig {
    return createAgentConfig({
        role: preset.role,
        roleDescription: preset.roleDescription,
        reasoningStyle: preset.reasoningStyle,
        reasoningDepth: preset.reasoningDepth,
        knowledgeMode: preset.knowledgeMode,
        knowledgeStrict: preset.knowledgeStrict,
        preset: preset.key,
    });
}
