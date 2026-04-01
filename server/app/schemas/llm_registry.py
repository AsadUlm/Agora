"""
Pydantic response schemas for the LLM registry API endpoints.

These are the shapes exposed via ``GET /llm/providers`` and ``GET /llm/models``.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ModelInfoResponse(BaseModel):
    id: str
    name: str
    context_window: int = 0
    supports_json_mode: bool = False
    description: str = ""


class ProviderInfoResponse(BaseModel):
    id: str
    name: str
    status: str
    description: str = ""
    models: list[ModelInfoResponse] = Field(default_factory=list)


class ProvidersListResponse(BaseModel):
    providers: list[ProviderInfoResponse]


class ModelsListResponse(BaseModel):
    models: list[ModelInfoResponse]


class AgentConfigOptionsResponse(BaseModel):
    """Describes valid values for the typed agent configuration sections."""

    reasoning_styles: list[str]
    reasoning_depths: list[str]
    providers: list[ProviderInfoResponse]
