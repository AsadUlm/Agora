"""Pydantic schemas for the Agent Presets API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

AgentPresetType = Literal["system", "user"]
AgentPresetVisibility = Literal["private", "shared", "system"]
RagMode = Literal["no_docs", "shared_session_docs", "assigned_docs_only"]


class AgentPresetBase(BaseModel):
    """Configuration fields shared by create / update payloads."""

    role_description: str = Field(default="", max_length=4000)
    reasoning_style: str = Field(..., min_length=1, max_length=80)
    reasoning_depth: str = Field(..., min_length=1, max_length=40)

    provider: str = Field(..., min_length=1, max_length=50)
    model: str = Field(..., min_length=1, max_length=120)
    model_preset: Optional[str] = Field(default=None, max_length=40)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)

    rag_mode: RagMode = "shared_session_docs"
    document_ids: list[str] = Field(default_factory=list)
    strict_grounding: bool = False


class AgentPresetCreate(AgentPresetBase):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: AgentPresetVisibility = "private"
    is_default: bool = False


class AgentPresetUpdate(BaseModel):
    """All fields optional — partial PATCH."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: Optional[AgentPresetVisibility] = None

    role_description: Optional[str] = Field(default=None, max_length=4000)
    reasoning_style: Optional[str] = Field(default=None, min_length=1, max_length=80)
    reasoning_depth: Optional[str] = Field(default=None, min_length=1, max_length=40)

    provider: Optional[str] = Field(default=None, min_length=1, max_length=50)
    model: Optional[str] = Field(default=None, min_length=1, max_length=120)
    model_preset: Optional[str] = Field(default=None, max_length=40)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)

    rag_mode: Optional[RagMode] = None
    document_ids: Optional[list[str]] = None
    strict_grounding: Optional[bool] = None

    is_default: Optional[bool] = None
    is_archived: Optional[bool] = None


class AgentPresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: Optional[str] = None

    name: str
    description: Optional[str] = None

    type: AgentPresetType
    visibility: AgentPresetVisibility = "private"

    role_description: str
    reasoning_style: str
    reasoning_depth: str

    provider: str
    model: str
    model_preset: Optional[str] = None
    temperature: float

    rag_mode: RagMode
    document_ids: list[str] = Field(default_factory=list)
    strict_grounding: bool = False

    is_default: bool = False
    is_archived: bool = False

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
