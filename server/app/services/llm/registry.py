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
                    ModelInfo(id="llama-3.3-70b-versatile", name="LLaMA 3.3 70B", context_length=131072),
                    ModelInfo(id="mixtral-8x7b-32768", name="Mixtral 8x7B", context_length=32768),
                ],
            ),
            "openai": ProviderInfo(
                id="openai",
                name="OpenAI",
                status="configured",
                models=[
                    ModelInfo(id="gpt-4o", name="GPT-4o", context_length=128000),
                    ModelInfo(id="gpt-4o-mini", name="GPT-4o Mini", context_length=128000),
                ],
            ),
            "anthropic": ProviderInfo(id="anthropic", name="Anthropic", status="placeholder",
                                       models=[ModelInfo(id="claude-3-5-sonnet", name="Claude 3.5 Sonnet")]),
            "google": ProviderInfo(id="google", name="Google", status="placeholder",
                                    models=[ModelInfo(id="gemini-pro", name="Gemini Pro")]),
            "mistral": ProviderInfo(id="mistral", name="Mistral", status="placeholder",
                                     models=[ModelInfo(id="mistral-large", name="Mistral Large")]),
            "cohere": ProviderInfo(id="cohere", name="Cohere", status="placeholder",
                                    models=[ModelInfo(id="command-r-plus", name="Command R+")]),
            "deepseek": ProviderInfo(id="deepseek", name="DeepSeek", status="placeholder",
                                      models=[ModelInfo(id="deepseek-chat", name="DeepSeek Chat")]),
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
