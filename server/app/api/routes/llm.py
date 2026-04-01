"""
LLM / Agent-configuration API routes.

GET /llm/providers            — list all known providers with status
GET /llm/models               — list models (optional ``?provider=groq`` filter)
GET /agents/config/options    — enumeration of valid config values for the UI
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.llm_registry import (
    AgentConfigOptionsResponse,
    ModelInfoResponse,
    ModelsListResponse,
    ProviderInfoResponse,
    ProvidersListResponse,
)
from app.services.llm.registry import get_registry

llm_router = APIRouter(prefix="/llm", tags=["LLM"])
agents_config_router = APIRouter(prefix="/agents", tags=["Agents Config"])


# ── /llm/providers ───────────────────────────────────────────────────────────


@llm_router.get("/providers", response_model=ProvidersListResponse)
async def list_providers() -> ProvidersListResponse:
    """Return all registered LLM providers with their models and status."""
    registry = get_registry()
    providers = [
        ProviderInfoResponse(
            id=p.id,
            name=p.name,
            status=p.status,
            description=p.description,
            models=[
                ModelInfoResponse(
                    id=m.id,
                    name=m.name,
                    context_window=m.context_window,
                    supports_json_mode=m.supports_json_mode,
                    description=m.description,
                )
                for m in p.models
            ],
        )
        for p in registry.list_providers()
    ]
    return ProvidersListResponse(providers=providers)


# ── /llm/models ──────────────────────────────────────────────────────────────


@llm_router.get("/models", response_model=ModelsListResponse)
async def list_models(
    provider: str | None = Query(default=None, description="Filter by provider id"),
) -> ModelsListResponse:
    """Return models, optionally filtered by provider."""
    registry = get_registry()
    models = [
        ModelInfoResponse(
            id=m.id,
            name=m.name,
            context_window=m.context_window,
            supports_json_mode=m.supports_json_mode,
            description=m.description,
        )
        for m in registry.list_models(provider=provider)
    ]
    return ModelsListResponse(models=models)


# ── /agents/config/options ───────────────────────────────────────────────────

_REASONING_STYLES = ["analytical", "creative", "balanced", "critical", "formal"]
_REASONING_DEPTHS = ["shallow", "normal", "deep"]


@agents_config_router.get("/config/options", response_model=AgentConfigOptionsResponse)
async def agent_config_options() -> AgentConfigOptionsResponse:
    """Return all valid enumerations for the agent config UI."""
    registry = get_registry()
    providers = [
        ProviderInfoResponse(
            id=p.id,
            name=p.name,
            status=p.status,
            description=p.description,
            models=[
                ModelInfoResponse(
                    id=m.id,
                    name=m.name,
                    context_window=m.context_window,
                    supports_json_mode=m.supports_json_mode,
                    description=m.description,
                )
                for m in p.models
            ],
        )
        for p in registry.list_providers()
    ]
    return AgentConfigOptionsResponse(
        reasoning_styles=_REASONING_STYLES,
        reasoning_depths=_REASONING_DEPTHS,
        providers=providers,
    )
