import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import debate as debate_routes
from app.api.routes.auth import router as auth_router
from app.api.routes.llm import agents_config_router, llm_router
from app.api.routes.users import router as users_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup / shutdown hooks can be added here (e.g., warm up DB pool)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agora — AI Debate Platform",
        description=(
            "Backend API for the Agora AI Debate Platform. "
            "Start debates, run AI agents, and retrieve structured results."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(debate_routes.router, prefix="/debates", tags=["Debates"])
    app.include_router(llm_router)
    app.include_router(agents_config_router)

    return app


app = create_app()
