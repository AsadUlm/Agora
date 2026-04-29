"""LLM provider/model catalog endpoints.

Exposes the registry so the frontend can render provider/model dropdowns
from a single source of truth (server-side), and reports which providers
are actually configured (have an API key) at runtime.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.models.user import User
from app.services.llm._factory import _get_service_instance
from app.services.llm.providers.router import ProviderRouter
from app.services.llm.registry import ProviderInfo, ProviderRegistry

router = APIRouter(prefix="/llm", tags=["LLM"])

_registry = ProviderRegistry()


@router.get("/providers", response_model=list[ProviderInfo])
async def list_providers(_: User = Depends(get_current_user)) -> list[ProviderInfo]:
    """
    Return all known providers and their models.

    The `status` field is overridden at runtime:
      - "active"     → provider is registered with a valid API key
      - "configured" → catalogued but not loaded (no API key)
      - "placeholder" → not implemented yet
    """
    service = _get_service_instance()
    available: set[str] = set()
    if isinstance(service, ProviderRouter):
        available = {p.lower() for p in service.available_providers}

    # Only expose groq and openrouter to the UI — mock is internal, others unused.
    EXPOSED = {"groq", "openrouter"}
    providers = _registry.list_providers()
    result: list[ProviderInfo] = []
    for p in providers:
        if p.id not in EXPOSED:
            continue
        if p.id in available:
            status = "active"
        elif p.status == "placeholder":
            status = "placeholder"
        else:
            status = "configured"
        result.append(p.model_copy(update={"status": status}))
    return result
