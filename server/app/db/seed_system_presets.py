"""Manual entrypoint for refreshing built-in agent presets."""

from __future__ import annotations

import asyncio

from app.db.seed import seed_system_agent_presets
from app.db.session import AsyncSessionLocal


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await seed_system_agent_presets(db)


if __name__ == "__main__":
    asyncio.run(main())
