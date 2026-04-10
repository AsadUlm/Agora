"""
Shared test fixtures.

Sets up an in-memory SQLite database (via aiosqlite) and an httpx
AsyncClient wired to the FastAPI app with all DB and LLM dependencies
overridden for deterministic, isolated tests.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db, get_session_factory
from app.main import app
from app.services.llm import _factory as llm_factory
from app.services.llm.providers.mock_provider import MockProvider
from app.core.auth import get_current_user, get_ws_current_user
from app.models.user import User

# ---------------------------------------------------------------------------
# SQLite-compatible JSONB handling
#
# Our ORM models declare JSONB columns (PostgreSQL-specific).  When running
# against SQLite we need to compile them as plain JSON instead.
# ---------------------------------------------------------------------------
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402

# Use an in-memory SQLite database for tests.
TEST_DATABASE_URL = "sqlite+aiosqlite://"


@pytest.fixture(scope="session")
def _test_engine():
    """Create a session-scoped async engine for the test database.

    Uses StaticPool so all connections share the same in-memory
    SQLite database — required for cross-request data visibility.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )

    # Teach SQLAlchemy to render PostgreSQL JSONB as plain JSON on SQLite.
    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    return engine


@pytest.fixture(scope="session")
def _test_session_factory(_test_engine):
    return async_sessionmaker(
        bind=_test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )


@pytest.fixture(autouse=True)
async def _create_tables(_test_engine):
    """Create all tables before each test and drop them after."""
    # Register JSONB -> JSON compilation rule for SQLite dialect.
    from sqlalchemy.ext.compiler import compiles

    @compiles(JSONB, "sqlite")
    def _compile_jsonb_sqlite(type_, compiler, **kw):
        return "JSON"

    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture()
async def db_session(_test_session_factory):
    """Yield a fresh AsyncSession for direct DB assertions."""
    async with _test_session_factory() as session:
        yield session


@pytest.fixture()
async def client(_test_session_factory):
    """
    httpx AsyncClient wired to the FastAPI app.

    Overrides:
      • get_db  → uses the test SQLite session
      • LLMService singleton → MockProvider (no API calls)
    """

    async def _override_get_db():
        async with _test_session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Inject mock LLM service (using the factory's public override API)
    llm_factory.set_service(MockProvider())

    # Bypass JWT auth — return a deterministic fake user for all protected routes
    _fake_user = User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        email="test@example.com",
        name="Test User",
        password_hash="unused",
    )

    async def _override_get_current_user() -> User:
        return _fake_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    app.dependency_overrides[get_ws_current_user] = _override_get_current_user
    app.dependency_overrides[get_session_factory] = lambda: _test_session_factory

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    llm_factory.reset_service()
