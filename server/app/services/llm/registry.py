"""
LLM provider registry — catalog of available providers and their models.

Step 1 stub: defines the data shapes and a minimal registry with mock + placeholders.
Full provider implementations (Groq, OpenAI) are wired in Step 2.
"""

from __future__ import annotations

from pydantic import BaseModel


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int = 8192


class ProviderInfo(BaseModel):
    id: str
    name: str
    status: str  # "active" | "configured" | "placeholder"
    models: list[ModelInfo] = []


class ProviderRegistry:
    """
    Registry of all known LLM providers and their available models.
    """

    def __init__(self) -> None:
        self._providers: dict[str, ProviderInfo] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        self._providers = {
            "mock": ProviderInfo(
                id="mock",
                name="Mock (Testing)",
                status="active",
                models=[ModelInfo(id="mock-model", name="Mock Model")],
            ),
            "groq": ProviderInfo(
                id="groq",
                name="Groq",
                status="configured",
                models=[
                    ModelInfo(id="llama-3.3-70b-versatile", name="LLaMA 3.3 70B Versatile", context_length=131072),
                    ModelInfo(id="meta-llama/llama-4-scout-17b-16e-instruct", name="LLaMA 4 Scout 17B", context_length=131072),
                    ModelInfo(id="meta-llama/llama-4-maverick-17b-128e-instruct", name="LLaMA 4 Maverick 17B", context_length=131072),
                    ModelInfo(id="deepseek-r1-distill-llama-70b", name="DeepSeek R1 Distill 70B", context_length=131072),
                    ModelInfo(id="qwen/qwen3-32b", name="Qwen 3 32B", context_length=131072),
                    ModelInfo(id="moonshotai/kimi-k2-instruct", name="Kimi K2", context_length=131072),
                    ModelInfo(id="gemma2-9b-it", name="Gemma 2 9B", context_length=8192),
                ],
            ),
            "openrouter": ProviderInfo(
                id="openrouter",
                name="OpenRouter",
                status="configured",
                models=[
                    # Curated agent models
                    ModelInfo(id="openai/gpt-5", name="GPT-5", context_length=400000),
                    ModelInfo(id="openai/gpt-4.1-mini", name="GPT-4.1 Mini", context_length=1047576),
                    ModelInfo(id="google/gemini-2.5-flash", name="Gemini 2.5 Flash", context_length=1048576),
                    ModelInfo(id="anthropic/claude-haiku-4.5", name="Claude Haiku 4.5", context_length=200000),
                    ModelInfo(id="deepseek/deepseek-v3.2-exp", name="DeepSeek V3.2", context_length=163840),
                    ModelInfo(id="moonshotai/kimi-k2-thinking", name="Kimi K2.5", context_length=262144),
                    ModelInfo(id="x-ai/grok-4-fast", name="Grok 4.1 Fast", context_length=2000000),
                    ModelInfo(id="x-ai/grok-4", name="Grok 4 (Thinking)", context_length=256000),
                    # Moderator (fixed)
                    ModelInfo(id="anthropic/claude-sonnet-4.5", name="Claude Sonnet 4.5 (Moderator)", context_length=200000),
                ],
            ),
        }

    def get_provider(self, provider_id: str) -> ProviderInfo | None:
        return self._providers.get(provider_id)

    def list_providers(self) -> list[ProviderInfo]:
        """Return providers sorted: active first, then configured, then placeholders."""
        order = {"active": 0, "configured": 1, "placeholder": 2}
        return sorted(self._providers.values(), key=lambda p: order.get(p.status, 99))

    def list_models(self, provider: str | None = None) -> list[ModelInfo]:
        if provider:
            info = self.get_provider(provider)
            return info.models if info else []
        return [m for p in self._providers.values() for m in p.models]
