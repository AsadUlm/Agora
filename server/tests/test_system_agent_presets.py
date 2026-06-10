from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.seed import seed_system_agent_presets
from app.models.agent_preset import AgentPreset


async def test_system_presets_seeded(db_session: AsyncSession) -> None:
    await seed_system_agent_presets(db_session)

    rows = (
        await db_session.execute(
            select(AgentPreset).where(AgentPreset.is_system.is_(True))
        )
    ).scalars().all()

    assert {row.system_key for row in rows} == {
        "policy_analyst",
        "innovation_strategist",
        "critical_challenger",
    }
    assert all(row.user_id is None and row.visibility == "system" for row in rows)


async def test_system_preset_seed_is_idempotent_and_updates_by_key(
    db_session: AsyncSession,
) -> None:
    await seed_system_agent_presets(db_session)
    row = (
        await db_session.execute(
            select(AgentPreset).where(AgentPreset.system_key == "policy_analyst")
        )
    ).scalar_one()
    row.description = "stale"
    original_id = row.id
    await db_session.commit()

    await seed_system_agent_presets(db_session)
    rows = (
        await db_session.execute(
            select(AgentPreset).where(AgentPreset.system_key == "policy_analyst")
        )
    ).scalars().all()

    assert len(rows) == 1
    assert rows[0].id == original_id
    assert rows[0].description != "stale"


async def test_user_preset_same_name_not_overwritten(db_session: AsyncSession) -> None:
    user_preset = AgentPreset(
        user_id=uuid.uuid4(),
        name="Policy Analyst",
        description="My custom version",
        visibility="private",
        role_description="Custom",
        reasoning_style="balanced",
        reasoning_depth="normal",
        provider="openrouter",
        model="custom/model",
        temperature=0.7,
        rag_mode="no_docs",
        document_ids=[],
        strict_grounding=False,
        is_default=False,
        is_archived=False,
        is_system=False,
    )
    db_session.add(user_preset)
    await db_session.commit()

    await seed_system_agent_presets(db_session)
    await db_session.refresh(user_preset)

    assert user_preset.description == "My custom version"
    assert user_preset.is_system is False
    assert user_preset.system_key is None


async def test_system_presets_are_listed_and_read_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_system_agent_presets(db_session)
    preset = (
        await db_session.execute(
            select(AgentPreset).where(AgentPreset.system_key == "critical_challenger")
        )
    ).scalar_one()

    listed = await client.get("/agent-presets", params={"type": "system"})
    assert listed.status_code == 200
    assert {item["system_key"] for item in listed.json()} == {
        "policy_analyst",
        "innovation_strategist",
        "critical_challenger",
    }

    updated = await client.patch(
        f"/agent-presets/{preset.id}", json={"name": "Changed"}
    )
    deleted = await client.delete(f"/agent-presets/{preset.id}")
    duplicated = await client.post(f"/agent-presets/{preset.id}/duplicate")
    assert updated.status_code == 403
    assert deleted.status_code == 403
    assert duplicated.status_code == 201
    assert duplicated.json()["type"] == "user"
    assert duplicated.json()["system_key"] is None
