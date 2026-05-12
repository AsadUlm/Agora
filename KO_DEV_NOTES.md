# Ko Branch — Dev Notes
_Last updated: May 12, 2026_

---

## Session Log — 2026-05-12

### 1. Merged ui_lab into test_ui_branch
Fetched `origin/ui_lab` and merged 4 new commits into `test_ui_branch`. Clean merge, zero conflicts — 67 files, 9063 insertions. Key additions from ui_lab:
- Follow-up questions feature (new DB tables, backend routes, prompts)
- New UI panels: `AgentsPanel`, `CycleNavigator`, `DebateEvolutionPanel`, `RawOutputPanel`, `RightSidebar`
- Cloudinary-backed document storage layer
- Knowledge/retrieval pipeline (`knowledge/`, `retrieval/`, `storage/` services)

### 2. Fixed duplicate Alembic migrations
The merge brought in 3 files all claiming revision `0007`. Renumbered the two conflicting ones:

| Before | After |
|---|---|
| `0007_change_embedding_dim_to_768.py` | `0010_change_embedding_dim_to_768.py` |
| `0007_add_document_storage_columns.py` | `0011_add_document_storage_columns.py` |

Final chain: `0006 → 0007 → 0008 → 0009 → 0010 → 0011`

### 3. Fixed broken DB state
The DB was at version `0007` but the wrong `0007` had run — `debate_follow_ups` table and `cycle_number` column on `rounds` were missing. Manually applied the missing SQL via `psql`, then ran `alembic upgrade head`. All 4 pending migrations applied.

### 4. Fixed follow-up question crash
**Error:** `AttributeError: 'list' object has no attribute 'role'` — all agents failing on follow-up round.

**Root cause:** `_build_prompt` closure inside `start_followup_response_streaming` in `round_manager.py` was missing `packets` as its second parameter. When `_run_agent_task` called `prompt_builder(chunks, packets)`, the packets list landed in the `agent` slot.

**Fix:** Added `packets: list[EvidencePacket]` as the second parameter to the closure (line ~544 in `round_manager.py`) and passed it through to `build_followup_response_prompt` as `evidence_packets=packets`.

**Status:** Follow-up questions working end to end. ✓

---

## What This Branch Is

Frontend (ko) with full backend debate engine ported from `testing` branch.
Stack: React + TypeScript + Vite + MUI v7 (client) / FastAPI + SQLAlchemy + PostgreSQL (server)

---

## User Management

### How users get created
1. **Auto-seed on startup** — when the server boots with an empty `users` table, it creates one default user from `.env`:
   ```
   DEFAULT_USER_EMAIL=admin@agora.com
   DEFAULT_USER_PASSWORD=admin1234
   DEFAULT_USER_NAME=Admin
   ```
   Each team member runs their own local server and gets their own seed user.

2. **`POST /auth/signup`** — the signup page creates real users in the DB manually.

### Auth flow
- Login → `POST /auth/login` → returns `access_token` (30 min) + `refresh_token` (7 days)
- Access token stored in `localStorage` as `agora_access_token`
- Axios interceptor auto-attaches it as `Authorization: Bearer <token>` on every request
- On 401 → interceptor auto-refreshes using `agora_refresh_token`
- WebSocket auth → JWT passed as `?token=<jwt>` query param (browsers can't set headers on WS)

---

## Backend Changes Made (ko branch)

### Changes pulled straight from `testing` branch
| File/Directory | What it does |
|---|---|
| `server/app/services/llm/` | LLM provider layer — Groq + mock providers, factory, registry, JSON parser |
| `server/app/services/debate_engine/round_manager.py` | Per-round executor — calls LLM for each agent, saves messages, emits WS events |
| `server/app/services/debate_engine/prompts/` | Prompt builders for Round 1 (opening), Round 2 (critique), Round 3 (synthesis) |
| `server/app/services/debate_engine/__init__.py` | Package init |
| `server/app/services/chat_engine.py` | Turn orchestrator — runs all 3 rounds, transitions statuses, emits turn events |
| `server/app/services/execution_runner.py` | Background task wrapper — opens its own DB session, runs ChatEngine after HTTP response is sent |
| `server/app/services/ws_manager.py` | WebSocket manager singleton — session + turn subscriber channels |
| `server/app/services/retrieval/` | RAG retrieval service (pgvector cosine search) |
| `server/app/api/routes/ws.py` | `WS /ws/chat-turns/{turn_id}` and `WS /ws/chat-sessions/{session_id}` |
| `server/app/api/routes/debate.py` | `POST /debates/start` (async/queued), `GET /debates/{id}`, `GET /debates` |
| `server/app/schemas/agent.py` | `AgentCreate` request schema |
| `server/app/schemas/agent_config.py` | `AgentConfig` — parsed from `AgentCreate.config` |
| `server/app/schemas/contracts.py` | Internal typed contracts between services (LLMRequest, TurnContext, ExecutionEvent, etc.) |
| `server/app/schemas/ws_payloads.py` | `serialize_event()` → WebSocket JSON |
| `server/app/schemas/debate.py` | Response DTOs (DebateStartResponse, DebateResponse, DebateListItem, etc.) |
| `server/app/models/round.py` | Updated Round model with `queued/running/completed/failed` statuses |
| `server/alembic/versions/0002_status_enum_cleanup.py` | Renames `started→running`, `success→completed` in DB enums |
| `server/alembic/versions/0003_add_queued_to_round_status.py` | Adds `queued` to `round_status` enum |

### Changes made manually (not in testing branch)

**`server/app/core/auth.py`** — Added `get_ws_current_user` dependency:
```python
async def get_ws_current_user(token: str = Query(default=""), db=...):
    # reads JWT from ?token= query param, raises WebSocketException on failure
```

**`server/app/core/config.py`** — Added LLM settings block:
```python
LLM_PROVIDER: str = "groq"
LLM_MODEL: str = "llama-3.3-70b-versatile"
LLM_TEMPERATURE: float = 0.7
GROQ_API_KEY: str | None = None
OPENAI_API_KEY: str | None = None
```

**`server/app/db/session.py`** — Added `get_session_factory`:
```python
def get_session_factory() -> Any:
    return AsyncSessionLocal
# Background tasks open their own DB sessions using this
```

**`server/app/main.py`** — Registered debate + WS routers:
```python
app.include_router(debate_router, prefix="/debates", tags=["Debates"])
app.include_router(ws_router, prefix="/ws", tags=["WebSocket"])
```

**`server/app/models/llm_call.py`** — Fixed enum mismatch (bug fix):
```python
# Was: started / success / failed
# Fixed to match DB after migration 0002:
class LLMCallStatus(str, enum.Enum):
    running = "running"
    completed = "completed"
    failed = "failed"
```

**`server/.env`** — Added Groq key + LLM config:
```
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
LLM_TEMPERATURE=0.7
GROQ_API_KEY=gsk_7ByAXz...  ← personal key, each member generates their own at console.groq.com
```

---

## Frontend Changes Made

### UI/Theme
- Dark "Midnight Tribune" theme — primary amber `#F5A623`, bg `#0F1117`, paper `#1A1D27`
- ChatGPT-style collapsible left sidebar (AppShell) — starts collapsed, balance icon trigger
- Autofill fix via MuiCssBaseline global override
- Custom amber balance/scale favicon (`client/public/favicon.svg`)
- Browser tab title: "AGORA"

### HomePage
- Folder-tab style input card (Start Debate / Agent Setup tabs)
- `moderatorOpen` state drives fixed moderator card (position: fixed, top: 72, right: 20)
- Floating amber hamburger button to toggle moderator card
- After submit: prompt area shrinks, debate timeline appears below
- Main content gets `pr: "316px"` when moderator card is open

### Debate Flow (wired to backend)
- `POST /debates/start` called on Start button click — sends question + default agents (Proponent / Opponent)
- WebSocket connects to `ws_turn_url` returned by backend
- Live events handled: `turn_started → round_started → message_created → turn_completed`
- Messages grouped by round, displayed side-by-side per round
- Text clamped to preview height (2-3 lines per field)
- On `turn_completed` → `GET /debates/{id}` fetched for agent map + reconciliation

### New Files
| File | Purpose |
|---|---|
| `client/src/types/debate.ts` | All debate-related TypeScript types |
| `client/src/types/ws.ts` | WebSocket event types + live state types |
| `client/src/services/debateService.ts` | `startDebate()`, `getDebate()`, `listDebates()`, `buildWsUrl()` |
| `client/src/hooks/useDebate.ts` | Main debate state hook — start/reset, WS events, agent map, reconciliation |
| `client/src/hooks/useDebateWebSocket.ts` | Low-level WS lifecycle hook — connect/disconnect/reconnect |
| `client/src/components/debate/ModeratorCard.tsx` | Fixed right-side panel with live round overview, agreement/conflict/insight/nextstep |

---

## Debate Flow (how it actually works)

```
User types question → clicks Start
    ↓
POST /debates/start
    → creates ChatSession + ChatAgents + ChatTurn in DB
    → commits immediately
    → schedules ChatEngine as BackgroundTask
    → returns { debate_id, turn_id, ws_turn_url } (status: "queued")
    ↓
Frontend connects WebSocket to ws_turn_url?token=<jwt>
    ↓
Background: ChatEngine runs
    Round 1 → Groq LLM called per agent → message_created WS event
    Round 2 → critiques → message_created WS events
    Round 3 → final synthesis → message_created WS events
    → turn_completed WS event
    ↓
Frontend calls GET /debates/{id} → full structured result + agent names
```

---

## LLM Setup
- Provider: Groq (`llama-3.3-70b-versatile`) — free tier at console.groq.com
- Each team member uses their own personal API key in `server/.env`
- Falls back to MockProvider if `GROQ_API_KEY` is not set (returns hardcoded dummy responses)
- No key sharing needed between team members

---

## Running Locally
```bash
# Server
cd server
uvicorn app.main:app --reload

# Client
cd client
npm run dev
```
Visit `http://localhost:5173` — login with `admin@agora.com` / `admin1234`
