# Deploying Agora to Docker Hub

This document describes how to package the Agora full-stack app (FastAPI
backend + Vite/React frontend) into a single production Docker image and
publish it to Docker Hub.

> **Scope:** image build + push only. Cloud Run / Cloud SQL wiring lives
> in a follow-up step.

---

## 1. What ships in the image

```
docker.io/<user>/agora:<tag>
 ├── /app/                 ← FastAPI backend (server/)
 │   ├── app/              ← Python source
 │   ├── alembic/          ← migrations
 │   └── static/           ← Vite production bundle (index.html + assets/)
 └── CMD: uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
```

**Not included:**

- PostgreSQL — provided externally via `DATABASE_URL`.
- Frontend source / `node_modules` — only the compiled bundle is copied in.
- Local `.env` files — pass secrets at run time.

---

## 2. Required environment variables

| Variable                   | Required | Notes |
|----------------------------|:--------:|-------|
| `DATABASE_URL`             | yes      | e.g. `postgresql+asyncpg://user:pwd@host:5432/db` (must include the `pgvector` extension). |
| `JWT_SECRET`               | yes      | Random ≥ 32-byte string. |
| `DEFAULT_USER_EMAIL`       | yes      | Seeded on first boot if DB is empty. |
| `DEFAULT_USER_PASSWORD`    | yes      | Seeded on first boot if DB is empty. |
| `CORS_ORIGINS`             | no       | Comma-separated; defaults to `http://localhost:5173`. When the frontend is served from the same origin you can leave it empty. |
| `LLM_PROVIDER`             | no       | `openrouter` (default), `openai`, `groq`, `mock`. |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` | conditional | Required for the matching `LLM_PROVIDER`. |
| `EMBEDDING_PROVIDER`       | no       | `mock` (default), `openrouter`, `openai`. |
| `DOCUMENT_STORAGE_PROVIDER`| no       | `local` (default) or `cloudinary`. |
| `CLOUDINARY_*`             | conditional | Required when `DOCUMENT_STORAGE_PROVIDER=cloudinary`. |
| `PORT`                     | no       | Listening port. Default `8080` (matches Cloud Run). |

The frontend talks to the backend on the **same origin** in production
(`window.location`). No `VITE_API_BASE_URL` is required at build time — if
you want to override it, set it before invoking the build script.

---

## 3. Build & push

### POSIX / macOS / Linux / WSL

```bash
DOCKER_USERNAME=mydockeruser \
IMAGE_NAME=agora \
IMAGE_TAG=v1 \
  ./scripts/build-and-push-docker.sh
```

### Windows PowerShell

```powershell
$env:DOCKER_USERNAME = "mydockeruser"
$env:IMAGE_NAME      = "agora"
$env:IMAGE_TAG       = "v1"
./scripts/build-and-push-docker.ps1
```

### What the script does

1. Detects the frontend package manager (`pnpm` → `yarn` → `npm`).
2. Installs dependencies and runs the production `build`.
3. Wipes `server/static/` and copies `client/dist/*` into it.
4. Runs `docker build -f Dockerfile .` from the repo root, tagging
   `docker.io/<DOCKER_USERNAME>/<IMAGE_NAME>:<IMAGE_TAG>`.
5. `docker push`es the tag (skip with `PUSH=0`).

### Useful flags

| Variable | Purpose |
|----------|---------|
| `PUSH=0` | Build only, do not push. |
| `PLATFORM=linux/amd64` | Use `docker buildx` to build for a specific platform (handy on Apple Silicon when targeting Cloud Run). |

You must `docker login` once before pushing:

```bash
docker login docker.io
```

---

## 4. Run locally

```bash
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgresql+asyncpg://user:pwd@host:5432/agora" \
  -e JWT_SECRET="change-me" \
  -e DEFAULT_USER_EMAIL="admin@agora.local" \
  -e DEFAULT_USER_PASSWORD="changeme" \
  -e OPENROUTER_API_KEY="sk-or-..." \
  docker.io/<DOCKER_USERNAME>/agora:<IMAGE_TAG>
```

Then open <http://localhost:8080>:

- `/`               → React SPA (`static/index.html`).
- `/assets/*`       → hashed Vite assets.
- `/auth`, `/users`, `/debates`, `/documents`, `/sessions`, `/llm`, `/ws/*`
                    → API & WebSocket routes (unchanged).
- `/docs`           → FastAPI Swagger UI.
- Any unknown non-API path → SPA fallback to `index.html` (client-side
  routing works on refresh).

---

## 5. Database migrations

Migrations are **not** run automatically on container start. Run them once
against the target DB before / during deploy:

```bash
docker run --rm \
  -e DATABASE_URL="postgresql+asyncpg://user:pwd@host:5432/agora" \
  --entrypoint sh \
  docker.io/<DOCKER_USERNAME>/agora:<IMAGE_TAG> \
  -c "alembic upgrade head"
```

The target Postgres instance must have the `pgvector` extension enabled
(`CREATE EXTENSION IF NOT EXISTS vector;`).

---

## 6. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| App boots but `/` returns JSON 404 | `server/static/` was empty at image build time — re-run the build script. |
| `WARNING: /app/static/index.html missing` in build logs | Same as above. |
| API calls 404 from the browser | The frontend was built with a stale `VITE_API_BASE_URL`. Rebuild without it (or set it to `""`). |
| `pgvector` errors on startup | Extension not enabled on the external Postgres. |
| `docker push` 401 | Run `docker login docker.io`. |
