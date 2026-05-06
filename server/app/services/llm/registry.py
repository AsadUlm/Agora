"""
LLM provider registry — catalog of available providers and modern models.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class OpenRouterModel(str, Enum):
    CLAUDE_SONNET_4_5 = "anthropic/claude-sonnet-4.5"
    CLAUDE_HAIKU_4_5 = "anthropic/claude-haiku-4.5"
    GPT_5_5 = "openai/gpt-5.5"
    GPT_4_1_MINI = "openai/gpt-4.1-mini"
    DEEPSEEK_V3_2 = "deepseek/deepseek-v3.2"
    GROK_4_1_FAST = "x-ai/grok-4.1-fast"
    GROK_4_THINKING = "x-ai/grok-4"
    KIMI_K2_5 = "moonshotai/kimi-k2.5"


class ModelPresetInfo(BaseModel):
    id: str
    name: str
    provider: str = "openrouter"
    model: str
    temperature: float = 0.7


MODERN_OPENROUTER_MODELS: tuple[tuple[OpenRouterModel, str, int], ...] = (
    (OpenRouterModel.CLAUDE_SONNET_4_5, "Claude Sonnet 4.5", 200000),
    (OpenRouterModel.CLAUDE_HAIKU_4_5, "Claude Haiku 4.5", 200000),
    (OpenRouterModel.GPT_5_5, "GPT-5.5", 400000),
    (OpenRouterModel.GPT_4_1_MINI, "GPT-4.1 Mini", 1047576),
    (OpenRouterModel.DEEPSEEK_V3_2, "DeepSeek V3.2", 163840),
    (OpenRouterModel.GROK_4_1_FAST, "Grok 4.1 Fast", 2000000),
    (OpenRouterModel.GROK_4_THINKING, "Grok 4 (Thinking)", 256000),
    (OpenRouterModel.KIMI_K2_5, "Kimi K2.5", 262144),
)

MODEL_PROVIDER_ROUTES: dict[str, str] = {
    model.value: "openrouter" for model, _, _ in MODERN_OPENROUTER_MODELS
}

MODEL_PRESETS: tuple[ModelPresetInfo, ...] = (
    ModelPresetInfo(
        id="fast",
        name="Fast",
        model=OpenRouterModel.GROK_4_1_FAST.value,
        temperature=0.6,
    ),
    ModelPresetInfo(
        id="balanced",
        name="Balanced",
        model=OpenRouterModel.CLAUDE_SONNET_4_5.value,
        temperature=0.7,
    ),
    ModelPresetInfo(
        id="high_quality",
        name="High Quality",
        model=OpenRouterModel.GPT_5_5.value,
        temperature=0.5,
    ),
)


def provider_for_model(model: str | None, requested_provider: str | None = None) -> str:
    """Resolve the provider for a known modern model id."""
    if model:
        provider = MODEL_PROVIDER_ROUTES.get(model)
        if provider:
            return provider
    return (requested_provider or "openrouter").lower()


class ModelInfo(BaseModel):
    id: str
    name: str
    context_length: int = 8192


class ProviderInfo(BaseModel):
    id: str
    name: str
    status: str  # "active" | "configured" | "placeholder"
    models: list[ModelInfo] = []
    presets: list[ModelPresetInfo] = []


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
            "openrouter": ProviderInfo(
                id="openrouter",
                name="OpenRouter",
                status="configured",
                models=[
                    ModelInfo(id=model.value, name=name, context_length=context_length)
                    for model, name, context_length in MODERN_OPENROUTER_MODELS
                ],
                presets=list(MODEL_PRESETS),
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
