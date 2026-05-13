import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.debate import router as debate_router
from app.api.routes.documents import router as documents_router
from app.api.routes.llm import router as llm_router
from app.api.routes.sessions import router as sessions_router
from app.api.routes.users import router as users_router
from app.api.routes.ws import router as ws_router
from app.api.static import mount_frontend
from app.core.config import settings
from app.db.seed import seed_default_user
from app.db.session import AsyncSessionLocal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSessionLocal() as db:
        await seed_default_user(db)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agora",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(debate_router, prefix="/debates", tags=["Debates"])
    app.include_router(documents_router, prefix="/documents", tags=["Documents"])
    app.include_router(sessions_router, prefix="/sessions", tags=["Sessions"])
    app.include_router(llm_router)
    app.include_router(ws_router, prefix="/ws", tags=["WebSocket"])

    # Frontend SPA must be mounted LAST so its catch-all does not shadow
    # any API route. Safe no-op when the static bundle is absent (dev mode).
    mount_frontend(app)

    return app


app = create_app()
