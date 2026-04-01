"""Pydantic schemas for user profile and settings."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class UserSettingsResponse(BaseModel):
    theme: str = "system"
    language: str = "en"
    notifications_enabled: bool = True

    model_config = {"from_attributes": True}


class UserSettingsUpdate(BaseModel):
    theme: str | None = None
    language: str | None = None
    notifications_enabled: bool | None = None


class UserProfileResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None = None
    auth_provider: str = "email"
    created_at: datetime
    settings: UserSettingsResponse

    model_config = {"from_attributes": True}