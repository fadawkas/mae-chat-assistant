# MAE — System Design & Build Plan (FastAPI / Python)

**Mae** is a self-hosted AI workspace: chat UI (React) + API (FastAPI) using
OpenRouter models, with an LLM council, a research skill, document skills
(docx/pptx/pdf/xlsx), and scheduled automation. Runs on Linux via Docker.

> **Stack decision (locked):** Python backend (FastAPI), React/TypeScript
> frontend, Postgres for data, Redis + ARQ for jobs and scheduling. Skills are
> Python-native, matching the libraries Anthropic's own skills use.

> Naming: **Mae** in the UI and prose; **MAE** / `mae` in code, repo, service,
> and env-var contexts.

This document is written to be handed to a coding agent (Cursor / Claude Code).
Build in the phase order given; each phase has acceptance criteria.

---

## 1. Core architecture principle: two lanes

The system has two distinct kinds of work. Do not blur them.

**Interactive lane (fast, async, no queue).**
Chat streaming. LLM calls are I/O-bound, so one async FastAPI process handles
many simultaneous streams via the event loop. Transport is SSE. This is what
makes "many chats at once" work — it is concurrency, not jobs.

**Background lane (slow, jobs).**
Research, council, document generation, scheduled automation. These take
seconds to minutes and must survive client disconnects. They run as **ARQ**
jobs on a Redis-backed queue, expose a `job_id`, and report progress via SSE.

```
                         ┌────────────────────────────┐
   Browser (React)  ───► │  nginx  (serves static UI,  │
   - chat panels         │         reverse-proxies API)│
   - multiple tabs       └──────────────┬─────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │  mae-api (FastAPI, uvicorn)│
                          │                            │
   INTERACTIVE LANE ─────►│  POST /api/chat  (SSE)     │──► OpenRouter
                          │                            │
   BACKGROUND LANE ─────► │  enqueue → ARQ             │
                          └──────┬───────────┬─────────┘
                                 │           │
                    ┌────────────▼──┐   ┌────▼─────────────────┐
                    │   Postgres    │   │  Redis + ARQ         │
                    │ chats,        │   │  job queue + state,  │
                    │ messages,jobs │   │  pub/sub, cron       │
                    └───────────────┘   └────┬─────────────────┘
                                             │
                                  ┌──────────▼───────────┐
                                  │  mae-worker (ARQ)     │──► OpenRouter (xN)
                                  │  council / research / │──► search API
                                  │  skills / automation  │──► LibreOffice,
                                  └───────────────────────┘    poppler, files
```

`mae-api` and `mae-worker` share the same codebase; the worker is just a second
entrypoint (`arq worker.WorkerSettings`) instead of the HTTP server.

---

## 2. Concurrency model (the "multiple chats" answer)

- **One chat stream = one async coroutine.** FastAPI/uvicorn (ASGI) serves
  hundreds concurrently on one process because the work waits on the network,
  not the CPU. No job queue for chat.
- **Transport = SSE.** Return `StreamingResponse(gen(),
  media_type="text/event-stream")`, yielding `data: <chunk>\n\n` per token and
  ending with `data: [DONE]\n\n`. The frontend reads it with `fetch` +
  `ReadableStream` (preferred over `EventSource` because POST + headers).
- **HTTP/2 multiplexing** removes the browser's per-domain connection limit, so
  several chat panels can stream at once. Enable HTTP/2 in nginx.
- **Switching saved chats** is just loading messages by `conversation_id` from
  Postgres. The API is stateless per request.
- **Scaling out:** run N uvicorn workers / `mae-api` replicas behind nginx;
  keep them stateless; all shared state lives in Postgres + Redis. Redis pub/sub
  lets a job on any worker stream progress to a client on any api replica.

Rule of thumb: **reach for the queue only when work must outlive the HTTP
request.** Chat never does; council/research/skills/automation always do.

---

## 3. Why Postgres + JSONB, not MongoDB (locked rationale)

- MAE's data is **relational at its core**: a message belongs to a
  conversation; a job belongs to a user. The most common query — "this
  conversation's messages, in order" — is a join. SQL does it effortlessly.
- The **flexible** parts (job payloads, model metadata) go in a **JSONB**
  column, giving document-style flexibility without a second database.
- **One datastore** is one thing to run, back up, and reason about — worth more
  than any scaling story for a solo/small project.
- Nothing in this stack forces Mongo (ARQ is Redis-backed). Don't add it.

Postgres + Redis covers the whole system.

---

## 4. Components

| Component   | Responsibility |
|-------------|----------------|
| `openrouter`| One async httpx client; `complete()` and `stream()`. OpenAI-compatible. |
| `chat`      | Interactive SSE streaming. Persists messages to Postgres. |
| `council`   | Fan one prompt out to N models with `asyncio.gather`, then a judge model synthesizes a verdict. ARQ job. |
| `research`  | search → fetch → synthesize report loop. ARQ job. |
| `skills`    | docx/pptx/pdf/xlsx builders. ARQ job (file output). |
| `automation`| ARQ **cron jobs** — the OpenClaw replacement. |
| `queue`     | ARQ setup: task functions, worker settings, progress via Redis pub/sub. |

---

## 5. Data model (Postgres, via SQLAlchemy 2.0 async)

```
conversations
  id            uuid pk
  title         text
  created_at    timestamptz

messages
  id              uuid pk
  conversation_id uuid fk -> conversations
  role            text   (system|user|assistant)
  content         text
  model           text
  created_at      timestamptz

jobs                       -- durable mirror of background work
  id          uuid pk
  type        text   (council|research|skill)
  status      text   (queued|active|done|failed)
  payload     jsonb  (request inputs)
  result      jsonb  (output / file path / report)
  error       text
  created_at  timestamptz
  updated_at  timestamptz
```

Live job state lives in Redis (ARQ owns it); mirror final results into the
`jobs` table so history survives a Redis flush. **Migrations:** Alembic.
**ORM:** SQLAlchemy 2.0 async (or SQLModel if you prefer Pydantic-style models).

---

## 6. API surface

```
POST /api/conversations            -> create chat, returns id
GET  /api/conversations            -> list (sidebar)
GET  /api/conversations/{id}       -> message history
POST /api/chat                     -> SSE token stream (interactive lane)

POST /api/council                  -> enqueue, returns {job_id}
POST /api/research                 -> enqueue, returns {job_id}
POST /api/documents                -> enqueue, returns {job_id} (file gen/edit/merge/split)

GET  /api/jobs/{id}                -> status + result (poll)
GET  /api/jobs/{id}/stream         -> SSE progress (subscribe)

GET  /api/automation/jobs          -> list cron jobs
GET  /api/models                   -> list OpenRouter models
GET  /api/files/{name}             -> download a generated file
```

Pydantic models define every request/response. FastAPI emits an OpenAPI schema
for free — use it (see section 7).

---

## 7. Tech stack

- **Language:** Python 3.12, async throughout, type-hinted.
- **Backend:** FastAPI + uvicorn. httpx (async) for OpenRouter + web fetches.
  Pydantic v2 for validation and settings.
- **Frontend:** React + Vite + TypeScript. Native `fetch` + `ReadableStream`
  for SSE.
- **Bridging the two languages:** FastAPI auto-generates an OpenAPI schema;
  run **`openapi-typescript`** to codegen a typed TS client for React. This
  recovers most of the "shared types" benefit you'd get from an all-TS stack —
  your frontend types are generated from the backend contract, not hand-copied.
- **Data:** Postgres (SQLAlchemy 2.0 async + Alembic).
- **Jobs + scheduling:** **ARQ** on Redis — handles background processing
  *and* cron jobs, so it covers both lanes in one tool (no separate scheduler).
- **Models:** OpenRouter (one API key, 300+ models, OpenAI-compatible).
- **Search (research):** Tavily or Brave Search API.
- **Skills:** Python-native (see section 7a).
- **Infra:** Docker Compose — services: `mae-api`, `mae-worker`, `mae-web`
  (nginx), `postgres`, `redis`. nginx terminates HTTP/2 and proxies `/api`.

### Environment variables

```
MAE_OPENROUTER_API_KEY=
MAE_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
MAE_DEFAULT_MODEL=anthropic/claude-3.5-sonnet
MAE_COUNCIL_MODELS=anthropic/claude-3.5-sonnet,openai/gpt-4o,google/gemini-2.0-flash-exp
MAE_SEARCH_API_KEY=
MAE_DATABASE_URL=postgresql+asyncpg://mae:mae@postgres:5432/mae
MAE_REDIS_URL=redis://redis:6379/0
MAE_OUTPUT_DIR=/data/outputs
```

### Repo layout

```
mae/
├── docker-compose.yml
├── .env.example
├── backend/              # mae-api + mae-worker (shared code)
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── app/
│       ├── main.py       # FastAPI app (api entrypoint)
│       ├── worker.py     # ARQ WorkerSettings (worker entrypoint)
│       ├── config.py
│       ├── schemas.py    # Pydantic models -> OpenAPI -> TS client
│       ├── openrouter.py
│       ├── routers/      # chat, council, research, skills, automation
│       ├── council/  research/  automation/
│       └── skills/       # see 7a
└── frontend/             # mae-web (React + Vite + TS, served by nginx)
    └── src/api/          # generated TS client (openapi-typescript)
```

---

## 7a. Skills architecture (mirroring `anthropics/skills`)

MAE's skills copy the **structure and patterns** of Anthropic's official skills
repo. On a Python stack you can also match their **library choices** directly,
since their scripts are Python. You still write your own code (see licensing).

> **Licensing — read before copying anything.** In `anthropics/skills`, the
> example skills (art, brand-guidelines, internal-comms, etc.) are **Apache
> 2.0** and reusable. The four document skills (docx/pdf/pptx/xlsx) are
> **source-available, for demonstration/education only — not licensed for
> product reuse.** Mirror their patterns and library choices; write your own
> code. Do not vendor their scripts into MAE.

### Folder layout (one per skill)

```
backend/app/skills/
├── docx/
│   ├── SKILL.md          # frontmatter (name, description) + workflow
│   ├── editing.md        # unpack → edit XML → repack guide
│   └── scripts/          # python utilities (extract, unpack, convert, validate)
├── pptx/
│   ├── SKILL.md
│   ├── html2pptx.md
│   ├── ooxml.md
│   └── scripts/
├── xlsx/
│   ├── SKILL.md
│   └── scripts/
└── pdf/
    ├── SKILL.md
    ├── FORMS.md
    └── scripts/
```

### Libraries & patterns (Python-native, matching Anthropic's)

- **Create from scratch:** `python-docx` (docx), `python-pptx` (pptx),
  `openpyxl` (xlsx); for pdf, render HTML via **WeasyPrint** or LibreOffice.
  *(Note: Anthropic's own SKILL.md uses docx-js/pptxgenjs for creation, but on
  Python the idiomatic, equally capable choice is python-docx/python-pptx.)*
- **Edit existing Office files:** a `.docx/.pptx/.xlsx` is a ZIP of XML —
  *unpack → edit the XML → repack*. Anthropic's editing pattern; language-
  agnostic. Use `zipfile` + `lxml`.
- **Read / extract text:** `markitdown` (or `pandoc`) — CLI tools.
- **PDF manipulation:** `pypdf` / `PyMuPDF` (merge, split, forms, OCR).
- **Convert / rasterize:** LibreOffice (`soffice --headless --convert-to …`)
  and poppler (`pdftoppm`) for previews/thumbnails.
- **Validate:** Office outputs should pass an OOXML/validation check before
  return (mirrors Anthropic's "zero formula errors" / clean-XML rule).

### Required system packages in the worker image

Bake into `backend`'s Dockerfile (build time): `libreoffice` (soffice),
`poppler-utils` (pdftoppm), `pandoc`/`markitdown`, and WeasyPrint's deps
(`libpango`, `libcairo`, `libgdk-pixbuf`). These are the only non-Python deps.

---

## 8. Build plan (phase order)

**Phase 0 — Skeleton & Docker.**
Compose with mae-api + mae-worker + mae-web + postgres + redis. FastAPI
`/health` returns ok. React shell renders. nginx proxies `/api`. Set up
Pydantic settings + the openapi-typescript codegen step.
*Done when:* `docker compose up` serves the UI and `/api/health` works.

**Phase 1 — Single streaming chat.**
`openrouter.stream()`, `POST /api/chat` SSE endpoint, React chat panel that
renders tokens as they arrive. No persistence yet.
*Done when:* you can talk to one model and watch tokens stream in.

**Phase 2 — Conversations & multi-chat.**
Postgres + SQLAlchemy schema (conversations, messages) + Alembic. Sidebar lists
chats; clicking loads history. Open two panels and stream both at once.
*Done when:* multiple chats stream simultaneously and persist across refresh.

**Phase 3 — Jobs infrastructure (ARQ).**
Queue + worker + progress events via Redis pub/sub. Generic `enqueue → status →
SSE progress` flow. mae-worker entrypoint runs ARQ.
*Done when:* a dummy 10-second job reports progress to the UI and survives a
page refresh (reconnect to `/api/jobs/{id}/stream`).

**Phase 4 — LLM council.**
Fan-out with `asyncio.gather`, judge synthesis, as an ARQ job. Catch per member
so one bad model returns a partial result. UI shows each member + the verdict.
*Done when:* one prompt returns N answers and a synthesized verdict.

**Phase 5 — Research skill.**
search → fetch → synthesize, as a job with progress. UI shows report + sources.
*Done when:* a query returns a sourced report.

**Phase 6 — Document skills.**
Build each skill as its own folder (SKILL.md + guides + scripts/, per section
7a): docx (python-docx), pptx (python-pptx), xlsx (openpyxl), pdf (WeasyPrint
or LibreOffice). Wire as ARQ jobs with download links. Bake LibreOffice/
poppler/markitdown into the worker image.
*Done when:* each skill produces a downloadable file and passes validation.

The current implementation exposes these jobs at `/api/documents`. Pandoc is
the default extraction tool. Office edit mode preserves the uploaded OOXML
package and changes only requested content; PDF support is limited to text
rebuild plus merge/split. Interactive PDF forms and OCR are deferred.

**Phase 7 — Automation.**
ARQ **cron jobs** with at least one example (e.g. nightly research → saved
report). Endpoint to list cron jobs.
*Done when:* a scheduled job runs on its own with no client connected.

**Phase 8 — Hardening.**
Auth (even single-user token), rate limiting, model-picker UI, error states,
multiple uvicorn workers, Redis pub/sub so progress works across replicas.

---

## 9. Gotchas to tell the coding agent

- Don't put chat behind the queue — it kills streaming latency for no reason.
- Keep the API stateless; never hold conversation state in process memory.
- SSE in FastAPI: yield from an async generator into `StreamingResponse`; make
  sure no middleware buffers the response (disable gzip on that route).
- SSE on the client: read the response body stream manually; `EventSource` only
  does GET, and you need POST + headers.
- One slow/broken council model must not sink the council — wrap each member in
  its own try/except and return partials.
- Regenerate the TS client (`openapi-typescript`) whenever Pydantic schemas
  change, so the frontend stays in sync with the API contract.
- The PDF/skills path needs LibreOffice + poppler (+ WeasyPrint deps) in the
  worker image — install at Docker build time, not runtime.
- Set OpenRouter `HTTP-Referer` and `X-Title` headers for attribution.
- Enable HTTP/2 in nginx or the per-domain connection limit throttles multiple
  simultaneous chat streams.
- Document skills from anthropics/skills are source-available — mirror the
  patterns, don't vendor their code.
