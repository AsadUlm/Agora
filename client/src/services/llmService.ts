import api from "./api";

export interface LLMModelInfo {
    id: string;
    name: string;
    context_length: number;
}

export type LLMProviderStatus = "active" | "configured" | "placeholder";

export interface LLMProviderInfo {
    id: string;
    name: string;
    status: LLMProviderStatus;
    models: LLMModelInfo[];
}

/**
 * Fetch the LLM provider catalog (providers + models) from the backend.
 * The `status` field reflects whether a provider is actually loaded
 * (i.e. has a configured API key) on the server.
 */
export async function fetchLLMProviders(): Promise<LLMProviderInfo[]> {
    const { data } = await api.get<LLMProviderInfo[]>("/llm/providers");
    return data;
}
