"""Pydantic schemas for user profile."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field


class UserProfileResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("name", "display_name"),
    )
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
