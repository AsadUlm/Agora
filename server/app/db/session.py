from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    pool_pre_ping=True,
    # Recycle connections every 5 min so stale asyncpg prepared-statement
    # caches (e.g. after an ALTER TYPE … ADD VALUE migration) get flushed.
    pool_recycle=300,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def invalidate_stale_connections() -> None:
    """Dispose the connection pool, forcing fresh connections on next use.

    Call this at application startup (or after running Alembic migrations)
    so that asyncpg picks up any new PostgreSQL enum values that were added
    via ``ALTER TYPE … ADD VALUE``.  Without this, asyncpg's internal
    prepared-statement cache holds a stale copy of the enum descriptor and
    rejects the new values with ``InvalidTextRepresentationError``.
    """
    await engine.dispose()



async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields an AsyncSession per request.
    Commits on success, rolls back on any exception.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def get_session_factory() -> Any:
    """
    FastAPI dependency that returns the async session factory.

    Background tasks and services that need their own DB sessions use this
    to create sessions safely outside the request scope.

    Override in tests to inject the test SQLite factory:
        app.dependency_overrides[get_session_factory] = lambda: test_factory
    """
    return AsyncSessionLocal
