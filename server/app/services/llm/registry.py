"""
Provider & Model Registry.

Central registry that enumerates all known LLM providers and their models.
Only Groq is currently *active* — all other providers are registered as
placeholders with ``status="placeholder"`` so the frontend can display
them while making clear they are not yet usable.

The registry reads environment variables (via ``settings``) to determine
which providers are actually configured (have API keys, etc.).

Usage:
    from app.services.llm.registry import get_registry

    registry = get_registry()
    providers = registry.list_providers()
    models    = registry.list_models(provider="groq")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Data structures ──────────────────────────────────────────────────────────


@dataclass
class ModelInfo:
    """Metadata for a single model offered by a provider."""

    id: str
    name: str
    context_window: int = 0
    supports_json_mode: bool = False
    description: str = ""


@dataclass
class ProviderInfo:
    """Metadata for a single LLM provider."""

    id: str
    name: str
    status: str  # "active" | "placeholder" | "configured"
    description: str = ""
    models: list[ModelInfo] = field(default_factory=list)


# ── Static catalogue ─────────────────────────────────────────────────────────

def _groq_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="llama-3.3-70b-versatile",
            name="LLaMA 3.3 70B Versatile",
            context_window=128_000,
            supports_json_mode=True,
            description="Default model — strong general-purpose reasoning.",
        ),
        ModelInfo(
            id="llama3-70b-8192",
            name="LLaMA 3 70B",
            context_window=8192,
            supports_json_mode=True,
            description="Older LLaMA 3 70B with 8K context.",
        ),
        ModelInfo(
            id="mixtral-8x7b-32768",
            name="Mixtral 8x7B",
            context_window=32_768,
            supports_json_mode=True,
            description="Mistral MoE model with 32K context.",
        ),
    ]


def _openai_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="gpt-4o",
            name="GPT-4o",
            context_window=128_000,
            supports_json_mode=True,
            description="Flagship multimodal model.",
        ),
        ModelInfo(
            id="gpt-4-turbo",
            name="GPT-4 Turbo",
            context_window=128_000,
            supports_json_mode=True,
            description="Fast GPT-4 variant with 128K context.",
        ),
        ModelInfo(
            id="gpt-3.5-turbo",
            name="GPT-3.5 Turbo",
            context_window=16_385,
            supports_json_mode=True,
            description="Cost-effective fast model.",
        ),
    ]


def _anthropic_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="claude-sonnet-4-20250514",
            name="Claude Sonnet 4",
            context_window=200_000,
            supports_json_mode=True,
            description="Best balance of speed and intelligence.",
        ),
        ModelInfo(
            id="claude-3-5-haiku-20241022",
            name="Claude 3.5 Haiku",
            context_window=200_000,
            supports_json_mode=True,
            description="Fastest Claude model.",
        ),
    ]


def _google_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="gemini-2.0-flash",
            name="Gemini 2.0 Flash",
            context_window=1_000_000,
            supports_json_mode=True,
            description="Ultra-fast multimodal model with 1M context.",
        ),
    ]


def _mistral_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="mistral-large-latest",
            name="Mistral Large",
            context_window=128_000,
            supports_json_mode=True,
            description="Top-tier Mistral reasoning model.",
        ),
    ]


def _cohere_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="command-r-plus",
            name="Command R+",
            context_window=128_000,
            supports_json_mode=True,
            description="Enterprise-grade RAG and reasoning.",
        ),
    ]


def _deepseek_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="deepseek-chat",
            name="DeepSeek Chat",
            context_window=64_000,
            supports_json_mode=True,
            description="High-performance open model.",
        ),
    ]


def _mock_models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="mock-default",
            name="Mock (deterministic)",
            context_window=0,
            supports_json_mode=True,
            description="Returns fixed JSON fixtures — for testing only.",
        ),
    ]


# ── Registry ─────────────────────────────────────────────────────────────────


class ProviderRegistry:
    """
    In-memory registry of all known providers and their models.

    Call ``list_providers()`` / ``list_models()`` for read access.
    Status is computed from env settings at construction time.
    """

    def __init__(self) -> None:
        self._providers: dict[str, ProviderInfo] = {}
        self._build()

    # -- public API -----------------------------------------------------------

    def list_providers(self) -> list[ProviderInfo]:
        """Return all providers sorted: active first, then alphabetical."""
        return sorted(
            self._providers.values(),
            key=lambda p: (0 if p.status == "active" else 1, p.id),
        )

    def list_models(self, provider: str | None = None) -> list[ModelInfo]:
        """Return models, optionally filtered to a single provider."""
        if provider:
            info = self._providers.get(provider)
            return list(info.models) if info else []
        return [m for p in self._providers.values() for m in p.models]

    def get_provider(self, provider_id: str) -> ProviderInfo | None:
        return self._providers.get(provider_id)

    # -- internal -------------------------------------------------------------

    def _register(self, info: ProviderInfo) -> None:
        self._providers[info.id] = info

    def _build(self) -> None:
        """Populate the registry from the static catalogue + runtime config."""

        # Groq — active if API key is present
        groq_status = "active" if settings.GROQ_API_KEY else "configured"
        self._register(ProviderInfo(
            id="groq",
            name="Groq",
            status=groq_status,
            description="Ultra-fast inference on open models via Groq LPU.",
            models=_groq_models(),
        ))

        # OpenAI — active if API key is present, else placeholder
        openai_status = "active" if settings.OPENAI_API_KEY else "placeholder"
        self._register(ProviderInfo(
            id="openai",
            name="OpenAI",
            status=openai_status,
            description="GPT-4o and GPT family from OpenAI.",
            models=_openai_models(),
        ))

        # Placeholders — no runtime implementation yet
        for pid, pname, pdesc, pfn in [
            ("anthropic", "Anthropic", "Claude model family from Anthropic.", _anthropic_models),
            ("google", "Google AI", "Gemini models from Google.", _google_models),
            ("mistral", "Mistral AI", "European open-weight models.", _mistral_models),
            ("cohere", "Cohere", "Enterprise-focused models.", _cohere_models),
            ("deepseek", "DeepSeek", "High-performance open models.", _deepseek_models),
        ]:
            self._register(ProviderInfo(
                id=pid, name=pname, status="placeholder",
                description=pdesc, models=pfn(),
            ))

        # Mock — always present for dev/test
        self._register(ProviderInfo(
            id="mock",
            name="Mock (testing)",
            status="active",
            description="Deterministic fixtures — no API calls.",
            models=_mock_models(),
        ))


# ── Module-level singleton ───────────────────────────────────────────────────

_registry: ProviderRegistry | None = None


def get_registry() -> ProviderRegistry:
    """Return the application-wide provider registry (lazy singleton)."""
    global _registry
    if _registry is None:
        _registry = ProviderRegistry()
        logger.info(
            "ProviderRegistry initialised — %d providers.",
            len(_registry._providers),
        )
    return _registry
