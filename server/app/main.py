import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import debate as debate_routes

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

    app.include_router(debate_routes.router, prefix="/debates", tags=["Debates"])

    return app


app = create_app()
