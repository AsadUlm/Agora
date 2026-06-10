"""
LLM provider registry — catalog of available providers and modern models.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class OpenRouterModel(str, Enum):
    # ── Anthropic ──────────────────────────────────────────────────────────
    CLAUDE_SONNET_4_6 = "anthropic/claude-sonnet-4-6"
    CLAUDE_SONNET_4_5 = "anthropic/claude-sonnet-4.5"
    CLAUDE_HAIKU_4_5 = "anthropic/claude-haiku-4.5"
    CLAUDE_OPUS_4_8 = "anthropic/claude-opus-4-8"
    CLAUDE_OPUS_4_7 = "anthropic/claude-opus-4-7"
    # ── OpenAI ────────────────────────────────────────────────────────────
    GPT_4_1_MINI = "openai/gpt-4.1-mini"
    GPT_4_1_NANO = "openai/gpt-4.1-nano"
    GPT_4O_MINI = "openai/gpt-4o-mini"
    # ── Google ────────────────────────────────────────────────────────────
    GEMINI_3_5_FLASH = "google/gemini-3.5-flash"
    GEMINI_3_1_PRO = "google/gemini-3.1-pro"
    GEMINI_2_0_FLASH = "google/gemini-2.0-flash-001"
    GEMINI_2_0_FLASH_LITE = "google/gemini-2.0-flash-lite-001"
    # ── xAI ───────────────────────────────────────────────────────────────
    GROK_4_3 = "xai/grok-4.3"
    GROK_4_THINKING = "x-ai/grok-4"
    # ── DeepSeek ──────────────────────────────────────────────────────────
    DEEPSEEK_V4_FLASH = "deepseek/deepseek-v4-flash"
    DEEPSEEK_V4_PRO = "deepseek/deepseek-v4-pro"
    DEEPSEEK_V3_2 = "deepseek/deepseek-v3.2"
    # ── Xiaomi MiMo ───────────────────────────────────────────────────────
    MIMO_V2_5 = "xiaomi/mimo-v2.5"
    MIMO_V2_5_PRO = "xiaomi/mimo-v2.5-pro"
    # ── Moonshot (Kimi) ───────────────────────────────────────────────────
    KIMI_K2_6 = "moonshot/kimi-k2.6"
    KIMI_K2_5 = "moonshot/kimi-k2.5"
    # ── Meta (Llama) ──────────────────────────────────────────────────────
    LLAMA_3_1_8B = "meta-llama/llama-3.1-8b-instruct"

    # ── Anthropic (legacy) ────────────────────────────────────────────────
    CLAUDE_3_HAIKU = "anthropic/claude-3-haiku"


class ModelPresetInfo(BaseModel):
    id: str
    name: str
    provider: str = "openrouter"
    model: str
    temperature: float = 0.7


MODERN_OPENROUTER_MODELS: tuple[tuple[OpenRouterModel, str, int], ...] = (
    # Anthropic
    (OpenRouterModel.CLAUDE_SONNET_4_6, "Claude Sonnet 4.6", 200000),
    (OpenRouterModel.CLAUDE_SONNET_4_5, "Claude Sonnet 4.5", 200000),
    (OpenRouterModel.CLAUDE_HAIKU_4_5, "Claude Haiku 4.5", 200000),
    (OpenRouterModel.CLAUDE_OPUS_4_8, "Claude Opus 4.8", 200000),
    (OpenRouterModel.CLAUDE_OPUS_4_7, "Claude Opus 4.7", 200000),
    # OpenAI
    (OpenRouterModel.GPT_4_1_MINI, "GPT-4.1 Mini", 1047576),
    (OpenRouterModel.GPT_4_1_NANO, "GPT-4.1 Nano", 1047576),
    (OpenRouterModel.GPT_4O_MINI, "GPT-4o Mini", 128000),
    # Google
    (OpenRouterModel.GEMINI_3_5_FLASH, "Gemini 3.5 Flash", 1000000),
    (OpenRouterModel.GEMINI_3_1_PRO, "Gemini 3.1 Pro", 1000000),
    (OpenRouterModel.GEMINI_2_0_FLASH, "Gemini 2.0 Flash", 1000000),
    (OpenRouterModel.GEMINI_2_0_FLASH_LITE, "Gemini 2.0 Flash Lite", 1000000),
    # xAI
    (OpenRouterModel.GROK_4_3, "Grok 4.3", 256000),
    (OpenRouterModel.GROK_4_THINKING, "Grok 4 (Thinking)", 256000),
    # DeepSeek
    (OpenRouterModel.DEEPSEEK_V4_FLASH, "DeepSeek V4 Flash", 163840),
    (OpenRouterModel.DEEPSEEK_V4_PRO, "DeepSeek V4 Pro", 163840),
    (OpenRouterModel.DEEPSEEK_V3_2, "DeepSeek V3.2", 163840),
    # Xiaomi MiMo
    (OpenRouterModel.MIMO_V2_5, "MiMo-V2.5", 131072),
    (OpenRouterModel.MIMO_V2_5_PRO, "MiMo-V2.5 Pro", 131072),
    # Moonshot (Kimi)
    (OpenRouterModel.KIMI_K2_6, "Kimi K2.6", 262144),
    (OpenRouterModel.KIMI_K2_5, "Kimi K2.5", 262144),
    # Meta (Llama)
    (OpenRouterModel.LLAMA_3_1_8B, "Llama 3.1 8B Instruct", 131072),
    # Anthropic (legacy)
    (OpenRouterModel.CLAUDE_3_HAIKU, "Claude 3 Haiku", 200000),
)

# Backward-compatibility routing for deprecated model IDs.  These IDs are no
# longer in the active catalog but may appear in historical debate records.
# Routing them to OpenRouter prevents replay/export from crashing.
_DEPRECATED_MODEL_ROUTES: dict[str, str] = {
    "x-ai/grok-4.1-fast": "openrouter",   # removed in catalog refresh
    "moonshotai/kimi-k2.5": "openrouter",  # old provider prefix; replaced by moonshot/kimi-k2.5
    "openai/gpt-5.5": "openrouter",        # removed; kept for historical debate records
    "openai/gpt-5.5-pro": "openrouter",   # removed; kept for historical debate records
}

MODEL_PROVIDER_ROUTES: dict[str, str] = {
    model.value: "openrouter" for model, _, _ in MODERN_OPENROUTER_MODELS
} | _DEPRECATED_MODEL_ROUTES

MODEL_PRESETS: tuple[ModelPresetInfo, ...] = (
    ModelPresetInfo(
        id="fast",
        name="Fast",
        model=OpenRouterModel.GROK_4_3.value,
        temperature=0.5,
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
        model=OpenRouterModel.CLAUDE_OPUS_4_7.value,
        temperature=0.5,
    ),
    ModelPresetInfo(
        id="deep_reasoning",
        name="Deep Reasoning",
        model=OpenRouterModel.GROK_4_THINKING.value,
        temperature=0.5,
    ),
    ModelPresetInfo(
        id="creative",
        name="Creative",
        model=OpenRouterModel.CLAUDE_SONNET_4_5.value,
        temperature=0.85,
    ),
    ModelPresetInfo(
        id="cost_efficient",
        name="Cost Efficient",
        model=OpenRouterModel.GPT_4_1_MINI.value,
        temperature=0.6,
    ),
    ModelPresetInfo(
        id="rag_optimized",
        name="RAG Optimized",
        model=OpenRouterModel.CLAUDE_SONNET_4_5.value,
        temperature=0.4,
    ),
    ModelPresetInfo(
        id="strict_grounded",
        name="Strict Grounded",
        model=OpenRouterModel.CLAUDE_SONNET_4_5.value,
        temperature=0.3,
    ),
    ModelPresetInfo(
        id="presentation_demo",
        name="Presentation Demo",
        model=OpenRouterModel.CLAUDE_SONNET_4_5.value,
        temperature=0.55,
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
