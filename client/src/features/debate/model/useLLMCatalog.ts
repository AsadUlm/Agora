import { useEffect, useState } from "react";
import { fetchLLMProviders, type LLMProviderInfo } from "@/services/llmService";

interface UseLLMCatalogResult {
    providers: LLMProviderInfo[];
    loading: boolean;
    error: string | null;
}

let _cache: LLMProviderInfo[] | null = null;
let _inflight: Promise<LLMProviderInfo[]> | null = null;

/**
 * Fetch and cache the LLM provider catalog from the backend.
 * Cached at module level so all consumers share one request.
 */
export function useLLMCatalog(): UseLLMCatalogResult {
    const [providers, setProviders] = useState<LLMProviderInfo[]>(_cache ?? []);
    const [loading, setLoading] = useState(_cache === null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (_cache) return;
        let cancelled = false;
        const promise = _inflight ?? (_inflight = fetchLLMProviders());
        promise
            .then((data) => {
                _cache = data;
                if (!cancelled) {
                    setProviders(data);
                    setLoading(false);
                }
            })
            .catch((e: unknown) => {
                _inflight = null;
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return { providers, loading, error };
}
