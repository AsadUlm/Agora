#!/usr/bin/env bash
# =============================================================================
# scripts/migrate-cloud-run.sh
#
# Run Alembic migrations against Cloud SQL (PostgreSQL) from a developer
# machine or CI pipeline, via the Cloud SQL Auth Proxy.
#
# Requirements:
#   - gcloud CLI authenticated (gcloud auth application-default login)
#   - cloud-sql-proxy binary in PATH  (or specify CLOUD_SQL_PROXY_PATH)
#   - Python venv with project deps at server/.venv
#
# Usage:
#   # Use env vars for one-off run:
#   CLOUD_SQL_INSTANCE=project:region:instance \
#   DB_NAME=agora \
#   DB_USER=agora-app \
#   DB_PASSWORD=secret \
#   ./scripts/migrate-cloud-run.sh
#
#   # Or set a variable file:
#   source .env.prod && ./scripts/migrate-cloud-run.sh
#
# Environment variables:
#   CLOUD_SQL_INSTANCE   GCP instance connection name  (required)
#                        e.g. my-project:europe-west1:agora-prod
#   DB_NAME              PostgreSQL database name       (default: agora)
#   DB_USER              PostgreSQL user                (default: agora-app)
#   DB_PASSWORD          PostgreSQL password            (required)
#   PROXY_PORT           Local proxy port               (default: 5433)
#   CLOUD_SQL_PROXY_PATH Path to cloud-sql-proxy binary (default: cloud-sql-proxy)
#   ALEMBIC_TARGET       Migration revision target      (default: head)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:?CLOUD_SQL_INSTANCE is required}"
DB_NAME="${DB_NAME:-agora}"
DB_USER="${DB_USER:-agora-app}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD is required}"
PROXY_PORT="${PROXY_PORT:-5433}"
PROXY_BIN="${CLOUD_SQL_PROXY_PATH:-cloud-sql-proxy}"
ALEMBIC_TARGET="${ALEMBIC_TARGET:-head}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/server"
VENV_PYTHON="${SERVER_DIR}/.venv/bin/python"
VENV_ALEMBIC="${SERVER_DIR}/.venv/bin/alembic"

log()  { echo "[migrate] $*"; }
fail() { echo "[migrate] ERROR: $*" >&2; exit 1; }

# ── Validate prerequisites ───────────────────────────────────────────────────
[[ -x "${VENV_PYTHON}" ]] || fail "Python venv not found at ${VENV_PYTHON}. Run: cd server && python -m venv .venv && pip install -r requirements.txt"
[[ -x "${VENV_ALEMBIC}" ]] || fail "Alembic not found in venv at ${VENV_ALEMBIC}"
command -v "${PROXY_BIN}" >/dev/null 2>&1 || fail "'${PROXY_BIN}' not found in PATH. Install: https://cloud.google.com/sql/docs/postgres/sql-proxy"

# ── Start Cloud SQL Auth Proxy ────────────────────────────────────────────────
PROXY_PIDFILE="/tmp/cloud-sql-proxy-$$.pid"

cleanup() {
    if [[ -f "${PROXY_PIDFILE}" ]]; then
        local pid; pid=$(<"${PROXY_PIDFILE}")
        log "Stopping Cloud SQL Proxy (PID ${pid})"
        kill "${pid}" 2>/dev/null || true
        rm -f "${PROXY_PIDFILE}"
    fi
}
trap cleanup EXIT

log "Starting Cloud SQL Proxy for ${CLOUD_SQL_INSTANCE} on 127.0.0.1:${PROXY_PORT}"
"${PROXY_BIN}" \
    "--instances=${CLOUD_SQL_INSTANCE}=tcp:${PROXY_PORT}" \
    &
echo $! > "${PROXY_PIDFILE}"

# Give the proxy a moment to establish the connection.
sleep 3

# ── Build DATABASE_URL pointing to the proxy ─────────────────────────────────
CLOUD_DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}"

# ── Run migrations ────────────────────────────────────────────────────────────
log "Running: alembic upgrade ${ALEMBIC_TARGET}"

(
    cd "${SERVER_DIR}"
    DATABASE_URL="${CLOUD_DATABASE_URL}" "${VENV_ALEMBIC}" upgrade "${ALEMBIC_TARGET}"
)

log "Migration completed successfully. DB is now at: $(
    cd "${SERVER_DIR}" && DATABASE_URL="${CLOUD_DATABASE_URL}" "${VENV_ALEMBIC}" current 2>/dev/null | tail -1
)"
