"""
DB seeder — runs once at application startup.

If the `users` table is empty, a default admin user is created
using credentials from environment variables (or config defaults).
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.user import User
from app.models.agent_preset import AgentPreset
from app.services.agent_presets.system_presets import SYSTEM_AGENT_PRESETS

logger = logging.getLogger(__name__)


async def seed_default_user(db: AsyncSession) -> None:
    """Create a default user if no users exist in the database."""
    count_result = await db.execute(select(func.count()).select_from(User))
    user_count = count_result.scalar_one()

    if user_count > 0:
        logger.debug("Seed skipped — %d user(s) already exist.", user_count)
        return

    user = User(
        id=uuid.uuid4(),
        email=settings.DEFAULT_USER_EMAIL,
        password_hash=hash_password(settings.DEFAULT_USER_PASSWORD),
        name=settings.DEFAULT_USER_NAME,
    )
    db.add(user)
    await db.commit()

    logger.info(
        "Default user created: email=%s  (change the password after first login)",
        settings.DEFAULT_USER_EMAIL,
    )


async def seed_system_agent_presets(db: AsyncSession) -> None:
    """Idempotently create or refresh built-in presets by stable system key."""
    keys = [preset["system_key"] for preset in SYSTEM_AGENT_PRESETS]
    existing = (
        await db.execute(select(AgentPreset).where(AgentPreset.system_key.in_(keys)))
    ).scalars().all()
    by_key = {preset.system_key: preset for preset in existing if preset.system_key}

    for definition in SYSTEM_AGENT_PRESETS:
        system_key = definition["system_key"]
        row = by_key.get(system_key)
        if row is None:
            row = AgentPreset(system_key=system_key)
            db.add(row)

        for field, value in definition.items():
            setattr(row, field, list(value) if field == "document_ids" else value)
        row.user_id = None
        row.is_system = True
        row.visibility = "system"

    await db.commit()
    logger.info("Seeded/refreshed %d system agent presets.", len(SYSTEM_AGENT_PRESETS))
