# Agora — AI Debate Platform: Backend Implementation Report

**Date:** 2026-03-18  
**Stack:** FastAPI · PostgreSQL · SQLAlchemy (async) · Alembic · Groq / OpenAI / Mock LLM

---

## 1. Project Structure

```
server/
├── alembic/                        # Database migration runner
│   ├── env.py                      # Async Alembic runner (asyncpg)
│   ├── script.py.mako              # Migration file template
│   └── versions/                   # Generated migration files (empty until first run)
├── alembic.ini                     # Alembic configuration
├── app/
│   ├── main.py                     # FastAPI app factory + lifespan hook
│   ├── core/
│   │   └── config.py               # Settings (pydantic-settings, reads .env)
│   ├── db/
│   │   ├── base.py                 # SQLAlchemy DeclarativeBase
│   │   └── session.py              # Async engine, session factory, get_db() dependency
│   ├── models/
│   │   ├── user.py                 # users table
│   │   ├── debate.py               # debates table + relationships
│   │   ├── agent.py                # agents table (JSONB config)
│   │   └── round.py                # rounds table (JSONB data)
│   ├── schemas/
│   │   ├── agent.py                # AgentCreate, AgentResponse
│   │   └── debate.py               # DebateStartRequest/Response, DebateResponse, RoundResponse
│   ├── api/
│   │   └── routes/
│   │       └── debate.py           # POST /debates/start · GET /debates/{id}
│   ├── services/
│   │   ├── llm/
│   │   │   ├── base.py             # LLMProvider abstract base class
│   │   │   ├── schemas.py          # LLMRequest, LLMResponse (internal)
│   │   │   ├── factory.py          # Provider factory (centralised selection)
│   │   │   ├── service.py          # LLMService + get_llm_service() singleton
│   │   │   ├── client.py           # Deprecated shim (backwards compat)
│   │   │   ├── providers/
│   │   │   │   ├── groq_provider.py    # AsyncGroq SDK
│   │   │   │   ├── openai_provider.py  # AsyncOpenAI SDK
│   │   │   │   └── mock_provider.py    # Deterministic fixtures (no API)
│   │   │   └── utils/
│   │   │       └── parser.py       # extract_json(): 3-stage JSON recovery
│   │   └── debate_engine/
│   │       ├── engine.py           # DebateEngine.run_debate() orchestrator
│   │       ├── round1.py           # Opening statements logic
│   │       ├── round2.py           # Cross-examination logic
│   │       ├── round3.py           # Final synthesis logic
│   │       └── prompts/
│   │           ├── round1_prompts.py
│   │           ├── round2_prompts.py
│   │           └── round3_prompts.py
│   └── utils/                      # Reserved for shared utilities
├── requirements.txt
├── .env.example
└── smoke_test.py                   # Offline integration test (parser + mock)
```

---

## 2. Database Schema

### `users`

| Column       | Type         | Notes           |
| ------------ | ------------ | --------------- |
| `id`         | UUID         | Primary key     |
| `email`      | VARCHAR(255) | Unique, indexed |
| `created_at` | TIMESTAMPTZ  | Auto-set        |

### `debates`

| Column       | Type        | Notes                                        |
| ------------ | ----------- | -------------------------------------------- |
| `id`         | UUID        | Primary key                                  |
| `user_id`    | UUID        | FK → users (nullable for anonymous sessions) |
| `question`   | TEXT        | The debate question                          |
| `status`     | VARCHAR(50) | `pending` → `in_progress` → `completed`      |
| `created_at` | TIMESTAMPTZ | Auto-set                                     |

### `agents`

| Column      | Type         | Notes                         |
| ----------- | ------------ | ----------------------------- |
| `id`        | UUID         | Primary key                   |
| `debate_id` | UUID         | FK → debates, indexed         |
| `role`      | VARCHAR(100) | e.g. `analyst`, `critic`      |
| `config`    | JSONB        | Arbitrary agent configuration |

### `rounds`

| Column         | Type    | Notes                 |
| -------------- | ------- | --------------------- |
| `id`           | UUID    | Primary key           |
| `debate_id`    | UUID    | FK → debates, indexed |
| `round_number` | INTEGER | 1, 2, or 3            |
| `data`         | JSONB   | Full round output     |

---

## 3. API Endpoints

### `POST /debates/start`

Starts a full 3-round debate end-to-end.

**Request:**

```json
{
  "question": "Should AI be regulated by governments?",
  "agents": [{ "role": "analyst" }, { "role": "critic" }]
}
```

**Behaviour:**

1. Creates `Debate` record (status: `in_progress`)
2. Creates all `Agent` records
3. Runs `DebateEngine.run_debate()` → 3 rounds
4. Saves 3 `Round` records in DB
5. Updates debate status → `completed`

**Response:**

```json
{
  "debate_id": "uuid",
  "question": "...",
  "status": "completed",
  "result": {
    "round1": [ ... ],
    "round2": [ ... ],
    "round3": [ ... ]
  }
}
```

---

### `GET /debates/{id}`

Returns a full debate with all agents and rounds.

**Response:** Full `DebateResponse` with agents array and rounds sorted by `round_number`.

---

## 4. Debate Engine

`DebateEngine.run_debate(question, agents)` orchestrates 3 sequential rounds. Within each round, all LLM calls are issued **concurrently** via `asyncio.gather`.

### Round 1 — Opening Statements

Each agent produces independently:

```json
{
  "agent_id": "uuid",
  "role": "analyst",
  "stance": "...",
  "key_points": ["...", "...", "..."],
  "confidence": 0.78
}
```

### Round 2 — Cross-Examination

All unique agent pairs generate a structured exchange:

```json
{
  "challenger_role": "analyst",
  "responder_role": "critic",
  "challenge": "...",
  "response": "...",
  "rebuttal": "..."
}
```

For N agents: generates **N × (N-1)** exchanges (both directions per pair).

### Round 3 — Final Synthesis

Each agent reflects on Round 1 stance + Round 2 exchanges:

```json
{
  "agent_id": "uuid",
  "role": "analyst",
  "final_stance": "...",
  "what_changed": "...",
  "remaining_concerns": "...",
  "recommendation": "..."
}
```

---

## 5. LLM Integration Architecture

### Provider Interface

```python
class LLMProvider(ABC):
    async def generate(self, prompt: str) -> str: ...
    @property
    def provider_name(self) -> str: ...
```

All concrete providers implement only these two members. The rest of the application never imports from provider-specific modules.

### Providers

| Provider   | Class            | Trigger                                      |
| ---------- | ---------------- | -------------------------------------------- |
| **Groq**   | `GroqProvider`   | `LLM_PROVIDER=groq` + `GROQ_API_KEY` set     |
| **OpenAI** | `OpenAIProvider` | `LLM_PROVIDER=openai` + `OPENAI_API_KEY` set |
| **Mock**   | `MockProvider`   | `LLM_PROVIDER=mock` (default)                |

### Factory

`factory.py` → `create_provider()` is the **single location** where provider selection happens. No if/else chains exist anywhere else in the codebase.

### LLMService

`LLMService` is the sole entry point for all LLM calls:

```python
service = get_llm_service()           # returns singleton
result: dict = await service.generate_structured(prompt)  # returns parsed dict
```

### JSON Parser (`utils/parser.py`)

3-stage recovery for unreliable LLM output:

1. **Direct parse** — fast path for well-behaved responses
2. **Strip markdown fences** — removes ` ```json ... ``` ` wrappers
3. **Brace extraction** — finds first `{...}` block in free-form text
4. **Graceful failure** — returns `{}` + logs error, never raises

---

## 6. Configuration

All settings live in `app/core/config.py` (pydantic-settings) and are overridden via `.env`:

| Variable          | Default                    | Description                                 |
| ----------------- | -------------------------- | ------------------------------------------- |
| `DATABASE_URL`    | `postgresql+asyncpg://...` | Async PostgreSQL connection string          |
| `LLM_PROVIDER`    | `mock`                     | Active provider: `groq` / `openai` / `mock` |
| `LLM_MODEL`       | `llama-3.3-70b-versatile`  | Model name sent to provider                 |
| `LLM_TEMPERATURE` | `0.7`                      | Sampling temperature                        |
| `GROQ_API_KEY`    | `""`                       | Required when `LLM_PROVIDER=groq`           |
| `OPENAI_API_KEY`  | `""`                       | Required when `LLM_PROVIDER=openai`         |
| `APP_ENV`         | `development`              | Enables SQL echo logging in dev             |

---

## 7. Migrations (Alembic)

Async-compatible Alembic setup using `asyncpg`. Migration URL is pulled from `settings.DATABASE_URL` at runtime — no duplication with `.env`.

```bash
# Generate a migration after model changes
alembic revision --autogenerate -m "describe change"

# Apply all pending migrations
alembic upgrade head

# Roll back one migration
alembic downgrade -1
```

---

## 8. Dependencies

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
sqlalchemy[asyncio]>=2.0.0
asyncpg>=0.29.0
alembic>=1.13.0
pydantic>=2.7.0
pydantic-settings>=2.2.0
python-dotenv>=1.0.0
groq>=0.9.0
openai>=1.30.0
httpx>=0.27.0
```

---

## 9. Running the Project

```bash
cd server

# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, LLM_PROVIDER, and the matching API key

# 3. Run database migrations
alembic upgrade head

# 4. Start the server
uvicorn app.main:app --reload
```

**Swagger UI:** `http://127.0.0.1:8000/docs`  
**ReDoc:** `http://127.0.0.1:8000/redoc`

---

## 10. Testing (Offline)

`smoke_test.py` verifies the parser and MockProvider with zero network calls:

```bash
python smoke_test.py
```

Expected output:

```
=== LLM Layer Smoke Tests ===

Parser:
  [OK] parser: plain JSON
  [OK] parser: markdown-fenced JSON
  [OK] parser: garbage input returns empty dict + error

Mock provider via LLMService:
  [OK] MockProvider: Round 1 opening statement
  [OK] MockProvider: Round 2 cross-examination
  [OK] MockProvider: Round 3 final synthesis

=== ALL TESTS PASSED ===
```

---

## 11. Extending the System

### Adding a new LLM provider

1. Create `app/services/llm/providers/my_provider.py` implementing `LLMProvider`
2. Add a builder function `_build_my_provider()` in `factory.py`
3. Register it with a new `if provider_name == "myprovider":` branch in `create_provider()`
4. Add `MY_PROVIDER_API_KEY` to `config.py` and `.env.example`

No other files need to change.

### Adding a new API endpoint

- Add route handlers to `app/api/routes/` (or a new route file)
- Register the router in `app/main.py`
- Business logic goes in `app/services/`, never in the route handler

---

## 12. Known Limitations / Next Steps

| Item                                    | Status                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| User authentication (JWT / OAuth2)      | Not implemented                                           |
| `user_id` binding on debate creation    | Column exists in DB, not populated via API yet            |
| WebSocket streaming of round results    | Not implemented                                           |
| Automated test suite (`pytest-asyncio`) | Only `smoke_test.py` exists                               |
| Docker / docker-compose                 | Not included                                              |
| Rate limiting / abuse protection        | Not implemented                                           |
| Alembic initial migration file          | Not yet generated (run `alembic revision --autogenerate`) |
