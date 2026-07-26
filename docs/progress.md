# Phase 0 — Skeleton & Docker is complete.

What was built:

All 18 files created to satisfy the Phase 0 acceptance criteria ("docker compose up serves the UI and /api/health works"):

File	Purpose
.env.example	All MAE_* environment variables documented
.gitignore	Ignores node_modules, .venv, __pycache__, .env, dist, etc.
.dockerignore	Ignores build artifacts from Docker context
backend/pyproject.toml	Dependencies: FastAPI, uvicorn, httpx, arq, SQLAlchemy 2.0 async, asyncpg, alembic, pydantic-settings
backend/app/config.py	Pydantic SettingsConfigDict with env_prefix="MAE_"
backend/app/schemas.py	Placeholder for future Pydantic request/response models
backend/app/main.py	FastAPI app with GET /api/health → {"status":"ok"}
backend/app/worker.py	ARQ WorkerSettings (empty function list, ready for future jobs)
backend/Dockerfile	Python 3.12-slim with LibreOffice, poppler, pandoc, WeasyPrint deps
frontend/package.json	React + Vite + TypeScript + openapi-typescript codegen
frontend/tsconfig.json	TypeScript config
frontend/vite.config.ts	Vite config (proxy /api to backend in dev)
frontend/index.html	Root HTML shell
frontend/src/main.tsx	React entry point
frontend/src/App.tsx	Minimal React shell
frontend/nginx.conf	nginx config: serves static files, proxies /api to mae-api with dynamic resolver, SSE-ready, HTTP/2 enabled
frontend/Dockerfile	Multi-stage: Node build → nginx runtime
docker-compose.yml	5 services (postgres, redis, mae-api, mae-worker, mae-web) with healthchecks
Services running:

mae-api — FastAPI on port 8000 (internal)
mae-worker — ARQ worker (restarting while waiting for Redis/Postgres to be ready)
mae-web — nginx on port 8080, proxying /api to mae-api
postgres — PostgreSQL 16
redis — Redis 7
Verified: curl http://localhost:8080/api/health → {"status":"ok"} The React shell is served at http://localhost:8080.


# Phase 1 — Single Streaming Chat: Complete.
8 files created/modified:

File	Change
backend/app/routers/__init__.py	Create — empty package init
backend/app/openrouter.py	Create — OpenRouterClient with stream() using async httpx, upstream error check (401/400 → raised), keepalive line skipping
backend/app/schemas.py	Modify — add ChatMessage and ChatRequest Pydantic models
backend/app/routers/chat.py	Create — POST /api/chat SSE endpoint with typed JSON events (`type: token
backend/app/main.py	Modify — wire OpenRouterClient singleton on app.state, include chat router
frontend/src/api/sse.ts	Create — typed SSE client with ReadableStream buffering, {stream:true} decoder, buffer-across-reads
frontend/src/ChatPanel.tsx	Create — React chat UI with model selector, text input, streaming output display, error/loading states
frontend/src/App.tsx	Modify — replace health-check shell with ChatPanel + header
Must-fixes addressed:

JSON-encoded SSE events ({"type":"token","text":"..."}) — newlines safe, no [DONE]/[ERROR] plain-text sentinels
Client-side partial-frame buffering — accumulates across reads, decoder.decode(value, {stream: true}) for UTF-8 boundary safety
X-Accel-Buffering: no response header — belt-and-suspenders on top of nginx proxy_buffering off
Upstream error detection — HTTP error codes from OpenRouter (bad key/mode) raised as exceptions, caught and forwarded as typed error events
.model_dump() on messages before sending to OpenRouter
Verified:

curl http://localhost:8080/api/health → {"status":"ok"}
curl -X POST .../api/chat with invalid model → {"type":"error","message":"..."}
UI served at http://localhost:8080 with title "Mae"
Docker Compose: all 5 services (postgres, redis, mae-api, mae-worker, mae-web) running


# Phase 2 — Multi-Conversation Persistence: Complete.

12 files created/modified:

File	Change
backend/app/database.py	Create — SQLAlchemy async engine, session factory, get_db dependency
backend/app/models.py	Create — Conversation and Message ORM models with relationships
backend/app/schemas.py	Modify — add ConversationCreateResponse, ConversationListItem, ConversationDetail, MessageOut
backend/app/routers/chat.py	Modify — persist user/assistant messages to DB; auto-title from first user message; ensure conversation exists on the fly
backend/app/routers/conversations.py	Create — CRUD endpoints: POST /api/conversations, GET /api/conversations, GET /api/conversations/{id}
backend/app/main.py	Modify — include conversations router
backend/alembic.ini	Create — Alembic configuration for async migrations
backend/alembic/env.py	Create — Alembic env with async run_migrations
backend/alembic/script.py.mako	Create — Alembic migration template
backend/alembic/versions/001_initial_conversations_and_messages.py	Create — Initial migration creating conversations and messages tables
frontend/src/types.ts	Create — TypeScript interfaces matching backend Pydantic models
frontend/src/api/conversations.ts	Create — fetchConversations, fetchConversation, createConversation API helpers
frontend/src/Sidebar.tsx	Create — Conversation list sidebar with new-chat button, active state
frontend/src/App.tsx	Modify — wire Sidebar + ChatPanel with activeId state, key-based re-mounting
frontend/src/ChatPanel.tsx	Modify — fetch conversation history on mount; send conversation_id to /api/chat; buildMessages from Turns

Bugs fixed post-implementation:

1. **MissingGreenlet error on GET /api/conversations/{id}** — `selectinload` was incompatible with the async session; changed to `joinedload(Conversation.messages)` with `.unique()` on the result to handle joined-load row duplication.

2. **Fragile turn pairing in ChatPanel** — The message loading loop assumed strict `user/assistant` pairs (`for i in range(0, len, 2)`), breaking on odd message counts. Rewritten to group by role: user messages start a new turn, assistant messages append to the last turn.

Verified:

- Database has 2 conversations persisted with 22 messages across them
- `GET /api/conversations` returns conversation list sorted by created_at desc
- `GET /api/conversations/{id}` returns conversation with full message history as JSON
- Switching conversations in the UI loads the correct history via the API
- New chats are created and persisted on first message
- Chat panel loads properly even if the last message has no assistant reply (e.g., streaming error)


# Phase 3 — Jobs Infrastructure (ARQ): Complete.

12 files created/modified:

File	Change
backend/app/models.py	Modify — add Job ORM model (id, type, status, payload JSONB, result JSONB, error, created_at, updated_at)
backend/alembic/versions/002_jobs_table.py	Create — Alembic migration creating the jobs table (depends on 001)
backend/app/schemas.py	Modify — add JobEnqueueResponse, JobStatusResponse, JobProgressEvent Pydantic models
backend/app/queue.py	Create — Redis helpers (get_redis, get_arq_redis), subscribe_progress() async generator with pub/sub cleanup on disconnect, dummy_job() with DB status writes and error-path
backend/app/worker.py	Modify — register dummy_job in WorkerSettings.functions
backend/app/routers/jobs.py	Create — three endpoints: POST /api/jobs/dummy (enqueue + DB row), GET /api/jobs/{id} (poll DB), GET /api/jobs/{id}/stream (SSE — checks DB first for terminal state, subscribes to Redis pub/sub for live events, stops on terminal)
backend/app/main.py	Modify — import Job model, include jobs router, import jobs module
backend/alembic/env.py	Modify — import Job model for migration auto-detection
frontend/src/types.ts	Modify — add JobStatus, JobEnqueueResponse, JobProgressEvent TypeScript interfaces
frontend/src/api/jobs.ts	Create — enqueueDummyJob(), fetchJobStatus(), streamJobProgress() (async generator over SSE)
frontend/src/JobPanel.tsx	Create — React component with Start Dummy Job button, progress bar (0–100%), result/error display, localStorage persistence (`mae_job_id` key), reconnect-on-mount, AbortController cleanup on unmount
frontend/src/App.tsx	Modify — add Chat/Jobs view switcher in header, render JobPanel when Jobs tab is active

Key design decisions:

1. **Progress via Redis pub/sub** — `dummy_job` publishes `{"type":"progress","percent":N}` to `job:{id}:progress`; the SSE endpoint subscribes with a dedicated `redis.asyncio` connection cleaned up on client disconnect.

2. **Reconnection support** — `GET /api/jobs/{id}/stream` queries the DB first. If the job is `done`/`failed`, it emits one event and closes. Otherwise it subscribes to Redis. The frontend stores `mae_job_id` in localStorage.

3. **Error-path** — `dummy_job` wraps work in try/except, writes `status="failed"` + error to the jobs table, and publishes `{"type":"error","message":"..."}` before re-raising.

4. **Pub/sub cleanup** — `subscribe_progress()` uses `try/finally` in its listen loop, ensuring unsubscribe + close on `CancelledError` (client disconnect).

5. **No new dependencies** — `arq` + `redis` were already in pyproject.toml.

Verified:

- `POST /api/jobs/dummy` → `{"job_id":"<UUID>"}` ✅
- `GET /api/jobs/{id}/stream` → streams 11 progress events (0%–100%) then done, or returns terminal event immediately for already-complete jobs ✅
- `GET /api/jobs/{id}` → `{"status":"done","result":{"message":"Dummy job completed","slept_seconds":10}}` ✅
- `GET /api/health` → `{"status":"ok"}` (no regressions) ✅
- UI Jobs tab at http://localhost:8080 — Start Dummy Job button, progress bar animation, localStorage reconnect on refresh ✅


# Phase 4 — LLM Council: Complete.

24 files created/modified:

## Core council logic

| File | Change |
|---|---|
| `backend/app/council/council.py` | Create — `council_job()`: fan-out with `asyncio.gather` to N models, catch per-member so one bad model returns partial result, then judge model synthesizes a verdict |
| `backend/app/queue.py` | Modify — register `council_job` as a known ARQ function, publish progress events per phase |
| `backend/app/worker.py` | Modify — add `council_job` to `WorkerSettings.functions` |

## API layer

| File | Change |
|---|---|
| `backend/app/schemas.py` | Modify — add `CouncilRequest`, `CouncilMemberResult`, `CouncilResult`, council config CRUD schemas (`CouncilConfigCreate`, `CouncilConfigMemberIn/Out`, `CouncilConfigListItem`, `CouncilConfigDetail`) |
| `backend/app/routers/council.py` | Create — `POST /api/council` enqueue endpoint; resolves saved council config if `council_id` provided, baking member list + per-member system_prompts into job payload; falls back to saved `judge_model` from config |
| `backend/app/routers/councils.py` | Create — CRUD endpoints: `POST /api/councils`, `GET /api/councils`, `GET /api/councils/{id}`, `PUT /api/councils/{id}`, `DELETE /api/councils/{id}` |
| `backend/app/routers/jobs.py` | Modify — add `GET /api/jobs?type=...&limit=...` listing endpoint |
| `backend/app/main.py` | Modify — include council + councils routers; add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in lifespan for `jobs.council_id` and `councils.judge_model` |

## Data model

| File | Change |
|---|---|
| `backend/app/models.py` | Modify — add `Council` model (name, description, `judge_model`, created_at), `CouncilMember` model (council_id FK, model, `system_prompt`, position), `Job.council_id` FK to councils |
| `backend/alembic/versions/003_councils.py` | Create — Alembic migration: create councils + council_members tables, add council_id FK to jobs |
| `backend/Dockerfile` | Modify — copy `alembic.ini` and `alembic/` into container (needed for migration references, even though startup uses raw SQL) |

## Frontend — Council Panel

| File | Change |
|---|---|
| `frontend/src/types.ts` | Modify — add `CouncilRequest`, `CouncilMemberResult`, `CouncilResult`, `CouncilConfigCreate`, `CouncilConfigMemberIn/Out`, `CouncilConfigListItem`, `CouncilConfigDetail` |
| `frontend/src/api/council.ts` | Create — `enqueueCouncil()` helper |
| `frontend/src/api/councils.ts` | Create — `createCouncil()`, `listCouncils()`, `getCouncil()`, `deleteCouncil()` helpers |
| `frontend/src/api/jobs.ts` | Modify — add `listJobs()` helper |
| `frontend/src/CouncilPanel.tsx` | Create — full UI: council config selector + manager (create/delete), prompt input, member-by-member progress with checkmarks/errors, judging spinner, result display with **markdown rendering** (member responses + verdict), "Past Results" section with expandable history |

## Key design decisions

1. **Per-member error isolation** — Each council member is wrapped in `try/except` so one broken model doesn't sink the entire council. Partial results are returned.
2. **Saved configs with fallback** — `judge_model` can be saved per council config. When using the config, the saved model is the default; a per-request `judge_model` override wins.
3. **Self-contained jobs** — When a `council_id` is provided, the router resolves the member list and per-member `system_prompt` values at enqueue time and bakes them into the job payload. The worker never queries the DB for config — the job is self-contained.
4. **Markdown rendering** — Both live results and past results render member responses and verdicts with `ReactMarkdown` + `remarkGfm`, reusing the same code-block/copy pattern from ChatPanel.
5. **Past results persist** — The `jobs` table stores `result` as JSONB — all council outputs survive container restarts. The Past Results section fetches via `GET /api/jobs?type=council`.

## Bugs fixed

- **502 crash loop (#1)** — `alembic upgrade head` calls `asyncio.run()` inside the async lifespan, causing a crash loop. Replaced with raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` SQL.

# Phase 5 — Research Skill: Complete.

11 files created/modified:

## Backend (6 files)

| File | Change |
|------|--------|
| `backend/app/config.py` | **Modify** — add `search_base_url` (defaults to `https://api.tavily.com`) |
| `backend/app/schemas.py` | **Modify** — add `ResearchRequest`, `ResearchSource`, `ResearchResult` Pydantic models |
| `backend/app/research/__init__.py` | **Create** — empty package init |
| `backend/app/research/research.py` | **Create** — `research_job()` ARQ function: Tavily search → synthesis report via OpenRouter, progress via Redis pub/sub, error-isolated phases, content truncation for context limits |
| `backend/app/routers/research.py` | **Create** — `POST /api/research` enqueue endpoint (mirrors `routers/council.py`) |
| `backend/app/worker.py` | **Modify** — register `research_job` in `WorkerSettings.functions` |
| `backend/app/main.py` | **Modify** — include research router |

## Frontend (4 files)

| File | Change |
|------|--------|
| `frontend/src/types.ts` | **Modify** — add `ResearchSource`, `ResearchResult`, `ResearchProgressEvent`; extend `JobProgressEvent` union |
| `frontend/src/api/research.ts` | **Create** — `enqueueResearch()` API helper |
| `frontend/src/ResearchPanel.tsx` | **Create** — full UI: query textarea, model selector (per-request), phased progress (searching → synthesizing), source list with expandable preview cards, report with markdown rendering, past results section with expandable job history, localStorage reconnect |
| `frontend/src/App.tsx` | **Modify** — add Research tab to view switcher alongside Chat/Council |

## Key design decisions

1. **Tavily `include_raw_content=true`** — single API call replaces search + fetch loop; sources include full page text.
2. **Content truncation** — individual sources capped at 15K chars, total at 60K chars, prevents context overflow in synthesis call.
3. **Per-request model selection** — `ResearchRequest.model` optional (defaults to `settings.default_model`); ResearchPanel has a model selector dropdown.
4. **Partial results on synthesis failure** — job completes with `status="done"`, populated sources, and `report: null`. Only zero search results produces a result with empty sources.
5. **No new Python dependencies** — `httpx` already in pyproject.toml.
6. **No DB schema changes** — the existing `jobs` table `type` column is free-form; `type="research"` is already compatible.

## Acceptance criteria

- `POST /api/research` with `{"query":"...","model":"..."}` returns `{"job_id":"<UUID>"}`
- Job streams progress events: searching → synthesizing → done via Redis pub/sub
- `/api/jobs/{id}/stream` returns terminal event if job already complete (reconnect works)
- UI Research tab at `http://localhost:8080` — enter query, select model, watch phases, read sourced report
- Past results persist across page refresh via `GET /api/jobs?type=research`


# Current Implementation Audit

The repository has since moved from the original flat `routers/` layout to
`backend/app/api/routes/`, `backend/app/features/`, `backend/app/services/`,
and `frontend/src/features/`. The entries above are historical implementation
notes and should be read with that layout in mind.

## Phase Status

- **Phase 0 — Complete.** Docker Compose, API health, React shell, nginx, Postgres, Redis, and the isolated document sandbox are running services.
- **Phase 1 — Complete.** Chat streams through the interactive FastAPI SSE lane and persists messages.
- **Phase 2 — Partial.** Conversation persistence, history, and switching work. The UI intentionally renders one active chat pane rather than multiple panels in one view.
- **Phase 3 — Complete.** Durable ARQ jobs, status polling, Redis progress pub/sub, terminal SSE replay, retries, and cleanup are used by council, research, and document jobs. The old dummy-job endpoint is no longer part of the current API.
- **Phase 4 — Complete.** Council fan-out, per-member failure isolation, judging, saved configurations, history, and self-contained queued payloads are implemented.
- **Phase 5 — Complete.** Research search, synthesis, source display, progress, reconnect, and persisted history are implemented.
- **Phase 6 — Complete.** Document create/edit jobs support DOCX, PPTX, XLSX, and PDF; Office edit mode applies a narrow structure-preserving XML text replacement contract, artifacts are persisted with checksums, PDF merge/split operations are deterministic, and the restricted LibreOffice/Poppler renderer persists first-page thumbnails. The frontend exposes PDF merge/split controls and rendered previews. The available containerized document tests pass.
- **Phase 7 — Not started.** No ARQ cron job or automation API is currently registered.
- **Phase 8 — Complete.** Multi-user accounts, HttpOnly sessions, CSRF protection, encrypted per-user OpenRouter keys, owner-scoped application resources, tenant document paths, worker key resolution, Redis rate limits, account settings, dynamic model discovery, and the owner-constraint migration are implemented. Backend compilation, document tests, frontend build, authenticated/unauthenticated smoke checks, and a two-API-replica Docker smoke test pass.

- **Phase 7 — Implemented.** Persisted automation schedules support recurring research, council, and create-mode document jobs. The ARQ worker dispatches due schedules every minute, schedules support IANA timezones and cron expressions, and the API/UI provide schedule CRUD, run-now, enable state, and execution metadata. Existing durable job history and progress streaming are reused.

## Phase 6 Decisions

- The public endpoint is `POST /api/documents`; it supersedes the planned `/api/skills` name.
- Pandoc remains the extraction tool unless a specific MarkItDown capability becomes necessary.
- Office edit mode must preserve unaffected OOXML structure rather than regenerate from extracted text.
- PDF scope is text rebuild plus merge/split. Interactive forms and OCR are deferred.
