"""
Static file serving for the bundled frontend (Vite build).

Layout in production image:
    server/static/
        index.html
        assets/
            *.js, *.css, ...
        favicon.ico, ...

Routing strategy:
    - API routers (with explicit prefixes like /auth, /users, /debates, ...)
      are registered first and always win.
    - /assets/*  -> served from the bundled Vite assets directory.
    - /static/*  -> served from the same static dir (legacy convenience).
    - Any other GET that does not match an API route returns:
        * the file from static/ if it exists (favicon, robots.txt, etc.), OR
        * static/index.html (SPA history fallback).
    - WebSocket and any other prefix already handled by FastAPI routers
      take precedence — this module must be mounted LAST.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

# server/app/api/static.py -> server/
_SERVER_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_STATIC_DIR = _SERVER_ROOT / "static"

# API prefixes that must NEVER fall back to index.html. Anything starting
# with one of these returns a JSON 404 instead of the SPA shell.
_API_PREFIXES: tuple[str, ...] = (
    "auth",
    "users",
    "debates",
    "documents",
    "sessions",
    "llm",
    "ws",
    "docs",
    "redoc",
    "openapi.json",
    "static",
    "assets",
    "health",
)


def mount_frontend(app: FastAPI, static_dir: Path | None = None) -> None:
    """Mount Vite production build onto the FastAPI app.

    Safe no-op (with a warning) if the build directory is missing — useful
    for local dev where only the API runs.
    """

    static_dir = (static_dir or DEFAULT_STATIC_DIR).resolve()
    index_file = static_dir / "index.html"

    if not index_file.is_file():
        logger.warning(
            "Frontend static bundle not found at %s — skipping SPA mount. "
            "Run scripts/build-and-push-docker.sh (or build-and-push-docker.ps1) "
            "to populate it before building the Docker image.",
            static_dir,
        )
        return

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(assets_dir)),
            name="frontend-assets",
        )

    # /static/* convenience mount (kept for parity with the task spec).
    app.mount(
        "/static",
        StaticFiles(directory=str(static_dir)),
        name="frontend-static",
    )

    @app.get("/", include_in_schema=False)
    async def _spa_root() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str, request: Request) -> Response:
        # Never swallow API routes — return a real 404 for those.
        first_segment = full_path.split("/", 1)[0]
        if first_segment in _API_PREFIXES:
            raise HTTPException(status_code=404, detail="Not Found")

        # Serve real files from the bundle (favicon.ico, manifest.json, …)
        candidate = (static_dir / full_path).resolve()
        try:
            candidate.relative_to(static_dir)
        except ValueError:
            # Path traversal attempt — refuse.
            raise HTTPException(status_code=404, detail="Not Found")

        if candidate.is_file():
            return FileResponse(candidate)

        # SPA history fallback.
        return FileResponse(index_file)

    logger.info("Mounted frontend SPA from %s", static_dir)
