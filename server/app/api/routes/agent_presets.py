"""Agent Presets API.

Endpoints
---------
GET    /agent-presets                  list user + system presets
POST   /agent-presets                  create a user preset
GET    /agent-presets/{id}             retrieve one
PATCH  /agent-presets/{id}             update a user preset
DELETE /agent-presets/{id}             delete (or archive) a user preset
POST   /agent-presets/{id}/duplicate   duplicate any preset as a user preset
POST   /agent-presets/{id}/set-default mark a user preset as default

System presets are persisted, seeded by stable ``system_key``, and read-only
for normal users. They can be duplicated to create an editable user copy.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.agent_preset import AgentPreset
from app.models.user import User
from app.schemas.agent_preset import (
    AgentPresetCreate,
    AgentPresetOut,
    AgentPresetUpdate,
)
router = APIRouter(prefix="/agent-presets", tags=["Agent Presets"])


# ── Serialization helpers ────────────────────────────────────────────────────

def _preset_to_dict(preset: AgentPreset) -> dict:
    return {
        "id": str(preset.id),
        "user_id": str(preset.user_id) if preset.user_id else None,
        "is_system": preset.is_system,
        "system_key": preset.system_key,
        "name": preset.name,
        "description": preset.description,
        "type": "system" if preset.is_system else "user",
        "visibility": preset.visibility,
        "role_description": preset.role_description,
        "reasoning_style": preset.reasoning_style,
        "reasoning_depth": preset.reasoning_depth,
        "provider": preset.provider,
        "model": preset.model,
        "model_preset": preset.model_preset,
        "temperature": preset.temperature,
        "rag_mode": preset.rag_mode,
        "document_ids": list(preset.document_ids or []),
        "strict_grounding": preset.strict_grounding,
        "is_default": preset.is_default,
        "is_archived": preset.is_archived,
        "created_at": preset.created_at,
        "updated_at": preset.updated_at,
    }


def _matches_search(payload: dict, query: str) -> bool:
    if not query:
        return True
    q = query.lower()
    return (
        q in (payload.get("name") or "").lower()
        or q in (payload.get("description") or "").lower()
        or q in (payload.get("role_description") or "").lower()
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[AgentPresetOut])
async def list_agent_presets(
    *,
    type: Optional[str] = Query(default=None, pattern="^(system|user|all)$"),
    query: Optional[str] = Query(default=None, max_length=200),
    include_archived: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AgentPresetOut]:
    """Return system presets merged with the current user's presets."""

    result: list[dict] = []

    if type in (None, "all", "system"):
        stmt = (
            select(AgentPreset)
            .where(AgentPreset.is_system.is_(True))
            .where(AgentPreset.is_archived.is_(False))
            .order_by(AgentPreset.name.asc())
        )
        rows = (await db.execute(stmt)).scalars().all()
        for row in rows:
            payload = _preset_to_dict(row)
            if _matches_search(payload, query or ""):
                result.append(payload)

    if type in (None, "all", "user"):
        stmt = (
            select(AgentPreset)
            .where(AgentPreset.user_id == current_user.id)
            .where(AgentPreset.is_system.is_(False))
        )
        if not include_archived:
            stmt = stmt.where(AgentPreset.is_archived.is_(False))
        stmt = stmt.order_by(AgentPreset.updated_at.desc())
        rows = (await db.execute(stmt)).scalars().all()
        for row in rows:
            payload = _preset_to_dict(row)
            if _matches_search(payload, query or ""):
                result.append(payload)

    return [AgentPresetOut.model_validate(p) for p in result]


@router.post("", response_model=AgentPresetOut, status_code=status.HTTP_201_CREATED)
async def create_agent_preset(
    payload: AgentPresetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AgentPresetOut:
    visibility = payload.visibility if payload.visibility != "system" else "private"

    preset = AgentPreset(
        user_id=current_user.id,
        name=payload.name.strip(),
        description=payload.description,
        visibility=visibility,
        role_description=payload.role_description or "",
        reasoning_style=payload.reasoning_style,
        reasoning_depth=payload.reasoning_depth,
        provider=payload.provider,
        model=payload.model,
        model_preset=payload.model_preset,
        temperature=payload.temperature,
        rag_mode=payload.rag_mode,
        document_ids=list(payload.document_ids or []),
        strict_grounding=payload.strict_grounding,
        is_default=payload.is_default,
        is_system=False,
        system_key=None,
    )

    if payload.is_default:
        # Clear previous default for this user.
        await db.execute(
            update(AgentPreset)
            .where(AgentPreset.user_id == current_user.id)
            .where(AgentPreset.is_default.is_(True))
            .values(is_default=False)
        )

    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return AgentPresetOut.model_validate(_preset_to_dict(preset))


@router.get("/{preset_id}", response_model=AgentPresetOut)
async def get_agent_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AgentPresetOut:
    try:
        uid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(404, "Preset not found")

    row = await db.get(AgentPreset, uid)
    if row is None or (not row.is_system and row.user_id != current_user.id):
        raise HTTPException(404, "Preset not found")
    return AgentPresetOut.model_validate(_preset_to_dict(row))


@router.patch("/{preset_id}", response_model=AgentPresetOut)
async def update_agent_preset(
    preset_id: str,
    payload: AgentPresetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AgentPresetOut:
    try:
        uid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(404, "Preset not found")

    row = await db.get(AgentPreset, uid)
    if row is None or (not row.is_system and row.user_id != current_user.id):
        raise HTTPException(404, "Preset not found")
    if row.is_system:
        raise HTTPException(403, "System presets cannot be edited. Duplicate first.")

    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()

    if data.get("is_default") is True:
        await db.execute(
            update(AgentPreset)
            .where(AgentPreset.user_id == current_user.id)
            .where(AgentPreset.id != row.id)
            .where(AgentPreset.is_default.is_(True))
            .values(is_default=False)
        )

    for key, value in data.items():
        if key == "visibility" and value == "system":
            value = "private"
        setattr(row, key, value)

    await db.commit()
    await db.refresh(row)
    return AgentPresetOut.model_validate(_preset_to_dict(row))


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent_preset(
    preset_id: str,
    archive: bool = Query(default=False, description="If true, archive instead of delete."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        uid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(404, "Preset not found")

    row = await db.get(AgentPreset, uid)
    if row is None or (not row.is_system and row.user_id != current_user.id):
        raise HTTPException(404, "Preset not found")
    if row.is_system:
        raise HTTPException(403, "System presets cannot be deleted.")

    if archive:
        row.is_archived = True
    else:
        await db.delete(row)
    await db.commit()


@router.post("/{preset_id}/duplicate", response_model=AgentPresetOut, status_code=status.HTTP_201_CREATED)
async def duplicate_agent_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AgentPresetOut:
    try:
        uid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(404, "Preset not found")
    row = await db.get(AgentPreset, uid)
    if row is None or (not row.is_system and row.user_id != current_user.id):
        raise HTTPException(404, "Preset not found")
    source = _preset_to_dict(row)

    new_preset = AgentPreset(
        user_id=current_user.id,
        name=f"Copy of {source['name']}"[:120],
        description=source.get("description"),
        visibility="private",
        role_description=source.get("role_description") or "",
        reasoning_style=source["reasoning_style"],
        reasoning_depth=source["reasoning_depth"],
        provider=source["provider"],
        model=source["model"],
        model_preset=source.get("model_preset"),
        temperature=source.get("temperature", 0.7),
        rag_mode=source.get("rag_mode", "shared_session_docs"),
        document_ids=list(source.get("document_ids") or []),
        strict_grounding=bool(source.get("strict_grounding", False)),
        is_default=False,
        is_system=False,
        system_key=None,
    )
    db.add(new_preset)
    await db.commit()
    await db.refresh(new_preset)
    return AgentPresetOut.model_validate(_preset_to_dict(new_preset))


@router.post("/{preset_id}/set-default", response_model=AgentPresetOut)
async def set_default_agent_preset(
    preset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AgentPresetOut:
    try:
        uid = uuid.UUID(preset_id)
    except ValueError:
        raise HTTPException(404, "Preset not found")

    row = await db.get(AgentPreset, uid)
    if row is None or (not row.is_system and row.user_id != current_user.id):
        raise HTTPException(404, "Preset not found")
    if row.is_system:
        raise HTTPException(403, "System presets cannot be marked as default. Duplicate first.")

    await db.execute(
        update(AgentPreset)
        .where(AgentPreset.user_id == current_user.id)
        .where(AgentPreset.id != row.id)
        .values(is_default=False)
    )
    row.is_default = True
    await db.commit()
    await db.refresh(row)
    return AgentPresetOut.model_validate(_preset_to_dict(row))
