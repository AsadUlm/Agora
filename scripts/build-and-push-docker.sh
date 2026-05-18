#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the Agora frontend, copy the bundle into the backend, build the
# combined Docker image, and push it to Docker Hub.
#
# Usage (no env vars required — defaults are baked in):
#   ./scripts/build-and-push-docker.sh
#
# Defaults can still be overridden by exporting these env vars:
#   DOCKER_USERNAME  (default: asaddev13)
#   IMAGE_NAME       (default: agora-server)
#   IMAGE_TAG        (default: v1)
#   PUSH             (default: 1) Set to 0 to build only, no push.
#   PLATFORM         (optional) e.g. linux/amd64 — uses `docker buildx` if set.
#
# Notes:
#   * PostgreSQL is NOT installed in the image. Provide DATABASE_URL at run.
#   * Requires: node + npm, docker (logged in to Docker Hub for push).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log()  { printf '\033[1;36m[build]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 0. Resolve repo root (script lives in <repo>/scripts/) ──────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

CLIENT_DIR="${REPO_ROOT}/client"
SERVER_DIR="${REPO_ROOT}/server"
STATIC_DIR="${SERVER_DIR}/static"
DIST_DIR="${CLIENT_DIR}/dist"

# ── 1. Defaults (override via env if needed) ───────────────────────────────
DOCKER_USERNAME="${DOCKER_USERNAME:-asaddev13}"
IMAGE_NAME="${IMAGE_NAME:-agora-server}"
IMAGE_TAG="${IMAGE_TAG:-v1}"
PUSH="${PUSH:-1}"

DOCKER_IMAGE="docker.io/${DOCKER_USERNAME}/${IMAGE_NAME}:${IMAGE_TAG}"

command -v docker >/dev/null 2>&1 || fail "docker CLI not found in PATH"
[ -d "${CLIENT_DIR}" ] || fail "client/ directory not found at ${CLIENT_DIR}"
[ -d "${SERVER_DIR}" ] || fail "server/ directory not found at ${SERVER_DIR}"

# ── 2. Detect frontend package manager ──────────────────────────────────────
if [ -f "${CLIENT_DIR}/pnpm-lock.yaml" ]; then
  PKG_MANAGER="pnpm"
elif [ -f "${CLIENT_DIR}/yarn.lock" ]; then
  PKG_MANAGER="yarn"
else
  PKG_MANAGER="npm"
fi
log "Frontend package manager: ${PKG_MANAGER}"

# ── 3. Build frontend ───────────────────────────────────────────────────────
# Clean stale build artefacts first so no old localhost:8000 bundles survive.
log "Cleaning stale frontend build"
rm -rf "${DIST_DIR}"

log "Installing frontend dependencies in ${CLIENT_DIR}"
pushd "${CLIENT_DIR}" >/dev/null
case "${PKG_MANAGER}" in
  pnpm) pnpm install --frozen-lockfile || pnpm install ;;
  yarn) yarn install --frozen-lockfile || yarn install ;;
  npm)  if [ -f package-lock.json ]; then npm ci; else npm install; fi ;;
esac

# Ensure same-origin requests in the production bundle.
export VITE_API_BASE_URL="${VITE_API_BASE_URL-}"
export VITE_WS_BASE_URL="${VITE_WS_BASE_URL-}"
log "Building frontend production bundle (VITE_API_BASE_URL='${VITE_API_BASE_URL}')"
case "${PKG_MANAGER}" in
  pnpm) pnpm build ;;
  yarn) yarn build ;;
  npm)  npm run build ;;
esac
popd >/dev/null

[ -d "${DIST_DIR}" ] || fail "Frontend build output not found at ${DIST_DIR}"
[ -f "${DIST_DIR}/index.html" ] || fail "Frontend build is missing index.html (${DIST_DIR}/index.html)"

# Verify no localhost:8000 leaked into the built JS/CSS bundles.
# (Restrict to text assets — binary font files can produce false positives.)
log "Verifying production bundle contains no localhost:8000 references"
if [ -d "${DIST_DIR}/assets" ]; then
  if grep -rIl --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
       "localhost:8000" "${DIST_DIR}/assets" 2>/dev/null; then
    fail "localhost:8000 found in production bundle — check VITE_API_BASE_URL and VITE_WS_BASE_URL"
  fi
fi
log "Bundle clean — no localhost:8000 references found"

# ── 4. Copy build into backend/static ───────────────────────────────────────
log "Refreshing ${STATIC_DIR}"
rm -rf "${STATIC_DIR}"
mkdir -p "${STATIC_DIR}"
# Use a portable copy; trailing /. preserves contents and dotfiles.
cp -R "${DIST_DIR}/." "${STATIC_DIR}/"
[ -f "${STATIC_DIR}/index.html" ] || fail "Copy failed: ${STATIC_DIR}/index.html missing"
log "Frontend bundle staged at ${STATIC_DIR}"

# ── 5. Build Docker image (context = repo root) ─────────────────────────────
log "Building Docker image: ${DOCKER_IMAGE}"
if [ -n "${PLATFORM:-}" ]; then
  docker buildx build \
    --platform "${PLATFORM}" \
    -t "${DOCKER_IMAGE}" \
    -f Dockerfile \
    --load \
    .
else
  docker build -f Dockerfile -t "${DOCKER_IMAGE}" .
fi

# ── 6. Push ─────────────────────────────────────────────────────────────────
if [ "${PUSH}" = "1" ]; then
  log "Pushing ${DOCKER_IMAGE} to Docker Hub"
  docker push "${DOCKER_IMAGE}"
  log "Pushed: ${DOCKER_IMAGE}"
else
  log "PUSH=0 — skipping docker push. Built image: ${DOCKER_IMAGE}"
fi

log "Done."
