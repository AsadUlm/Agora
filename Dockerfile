# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Agora — production image (backend + bundled frontend)
#
# This Dockerfile expects the frontend to ALREADY be built and copied into
# server/static/  (the build script scripts/build-and-push-docker.{sh,ps1}
# does that automatically before invoking `docker build`).
#
# PostgreSQL is NOT installed in this image — the database must be provided
# externally via the DATABASE_URL environment variable (e.g. Cloud SQL).
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# Minimal OS deps. libpq isn't needed because we use asyncpg (pure Python).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Install Python dependencies first to maximise layer caching.
COPY server/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# 2) Copy backend source. server/static/ (frontend build) is included by
#    virtue of being inside server/.
COPY server/ /app/

# Sanity: warn at build time if the SPA bundle is missing.
RUN if [ ! -f /app/static/index.html ]; then \
    echo ">>> WARNING: /app/static/index.html missing — frontend will not be served."; \
    fi

EXPOSE 8080

# Honour Cloud Run / generic PaaS $PORT, default to 8080.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
