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
