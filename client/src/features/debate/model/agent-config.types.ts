/**
 * Agent Configuration Types — draft state for debate creation.
 */

export type KnowledgeMode = "no_docs" | "shared_session_docs" | "assigned_docs_only";

/** Maximum number of agents allowed in a single debate. Must match server MAX_DEBATE_AGENTS. */
export const MAX_DEBATE_AGENTS = 4;

// ── Agent color palette ──────────────────────────────────────────────────────

export interface AgentColorEntry {
    key: string;
    /** Hex for inline styles (swatches, badges). */
    hex: string;
    /** Full Tailwind gradient classes used in AgentNode. Must be static strings. */
    gradient: string;
}

export const AGENT_COLOR_PALETTE: AgentColorEntry[] = [
    { key: "violet", hex: "#7c3aed", gradient: "from-violet-600/80 to-violet-900/80" },
    { key: "rose", hex: "#e11d48", gradient: "from-rose-600/80 to-rose-900/80" },
    { key: "cyan", hex: "#0891b2", gradient: "from-cyan-600/80 to-cyan-900/80" },
    { key: "amber", hex: "#d97706", gradient: "from-amber-600/80 to-amber-900/80" },
    { key: "emerald", hex: "#059669", gradient: "from-emerald-600/80 to-emerald-900/80" },
    { key: "orange", hex: "#ea580c", gradient: "from-orange-600/80 to-orange-900/80" },
    { key: "pink", hex: "#db2777", gradient: "from-pink-600/80 to-pink-900/80" },
    { key: "blue", hex: "#2563eb", gradient: "from-blue-600/80 to-blue-800/80" },
];
export type ModelPresetKey =
    | "fast"
    | "balanced"
    | "high_quality"
    | "deep_reasoning"
    | "creative"
    | "cost_efficient"
    | "rag_optimized"
    | "strict_grounded"
    | "presentation_demo";

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
    /** Visual accent color key — one of AGENT_COLOR_PALETTE[].key */
    color: string;
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
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.5,
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
        model: "anthropic/claude-opus-4-7",
        temperature: 0.5,
    },
    {
        key: "deep_reasoning",
        label: "Deep Reasoning",
        provider: "openrouter",
        model: "x-ai/grok-4",
        temperature: 0.5,
    },
    {
        key: "creative",
        label: "Creative",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.85,
    },
    {
        key: "cost_efficient",
        label: "Cost Efficient",
        provider: "openrouter",
        model: "openai/gpt-4.1-mini",
        temperature: 0.6,
    },
    {
        key: "rag_optimized",
        label: "RAG Optimized",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.4,
    },
    {
        key: "strict_grounded",
        label: "Strict Grounded",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.3,
    },
    {
        key: "presentation_demo",
        label: "Presentation Demo",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        temperature: 0.55,
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
        color: "violet",
    },
    {
        _id: "default-2",
        role: "critic",
        roleDescription: "",
        reasoningStyle: "critical",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        modelPreset: "balanced",
        temperature: 0.6,
        enabled: true,
        knowledgeMode: "shared_session_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
        color: "rose",
    },
    {
        _id: "default-3",
        role: "creative",
        roleDescription: "",
        reasoningStyle: "creative",
        reasoningDepth: "normal",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        modelPreset: "high_quality",
        temperature: 0.5,
        enabled: true,
        knowledgeMode: "no_docs",
        knowledgeStrict: false,
        documentIds: [],
        customInstruction: "",
        preset: null,
        color: "cyan",
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
        // Anthropic
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-haiku-4.5",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-3-haiku",
        // OpenAI
        "openai/gpt-4.1-mini",
        "openai/gpt-4.1-nano",
        "openai/gpt-4o-mini",
        // Google
        "google/gemini-3.5-flash",
        "google/gemini-3.1-pro",
        "google/gemini-2.0-flash-001",
        "google/gemini-2.0-flash-lite-001",
        // xAI
        "xai/grok-4.3",
        "x-ai/grok-4",
        // DeepSeek
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v3.2",
        // Xiaomi MiMo
        "xiaomi/mimo-v2.5",
        "xiaomi/mimo-v2.5-pro",
        // Moonshot (Kimi)
        "moonshot/kimi-k2.6",
        "moonshot/kimi-k2.5",
        // Meta (Llama)
        "meta-llama/llama-3.1-8b-instruct",
    ],
};

/**
 * Model stability profiles (Phase 7).
 *
 * Experimental models frequently return malformed / truncated structured
 * output. They remain selectable, but are kept out of default presets and the
 * UI shows a warning when one is chosen.
 */
export const EXPERIMENTAL_MODELS: ReadonlySet<string> = new Set([
    "xiaomi/mimo-v2.5",
    "xiaomi/mimo-v2.5-pro",
    "google/gemini-3.5-flash",
    "google/gemini-2.0-flash-lite-001",
    "deepseek/deepseek-v4-flash",
    "xai/grok-4.3",
    "x-ai/grok-4",
    "moonshot/kimi-k2.5",
    "moonshot/kimi-k2.6",
    "meta-llama/llama-3.1-8b-instruct",
]);

export const EXPERIMENTAL_MODEL_WARNING =
    "This model may produce malformed structured output.";

export function isExperimentalModel(model: string | null | undefined): boolean {
    return !!model && EXPERIMENTAL_MODELS.has(model);
}


export const REASONING_STYLES = [
    "balanced",
    "analytical",
    "critical",
    "creative",
    "strategic",
    "evidence-based",
    "policy-oriented",
    "technical",
    "ethical",
    "pragmatic",
    "risk-focused",
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
    const id = ++_nextId;
    return {
        _id: `agent-${id}`,
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
        color: AGENT_COLOR_PALETTE[(id - 1) % AGENT_COLOR_PALETTE.length].key,
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
