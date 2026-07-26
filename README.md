# Mae

Mae is a self-hosted AI workspace. It provides authenticated streaming chat,
multi-model councils, research jobs, document generation, and scheduled
automation from one React application.

## What Is Included

- Account signup, sign-in, sign-out, and session-based authentication
- Streaming chat through OpenRouter
- Persistent conversations and message history
- Configurable AI councils with multiple member models and a judge model
- Background research jobs using a configured search provider
- Background document jobs that can produce DOCX, PPTX, PDF, and XLSX files
- Job status and progress streaming through Redis pub/sub
- Scheduled automation with manual run support
- Per-account OpenRouter key storage encrypted with `MAE_ENCRYPTION_KEY`

## Runtime Services

Mae runs as a Docker Compose stack:

| Service | Role |
| --- | --- |
| `mae-web` | React frontend and nginx API proxy on port `8080` |
| `mae-api` | FastAPI HTTP API and streaming chat endpoint |
| `mae-worker` | ARQ worker for councils, research, documents, and automation |
| `postgres` | Users, conversations, jobs, councils, schedules, and metadata |
| `redis` | ARQ queue and job progress pub/sub |
| `mae-renderer` | Isolated document rendering |
| `mae-sandbox` | Isolated workspace execution |

Chat stays in the HTTP request and streams its response. Long-running work is
stored as a job in Postgres, queued through Redis, and processed by
`mae-worker`.

## Run With Docker Compose

### Prerequisites

- Docker Engine with Docker Compose
- An OpenRouter API key
- A search API key if research is needed

### Setup

```bash
git clone https://github.com/YOUR-USERNAME/MAE.git
cd MAE
cp .env.example .env
```

Edit `.env` and set the required secrets:

```dotenv
MAE_OPENROUTER_API_KEY=your-openrouter-key
MAE_ENCRYPTION_KEY=your-long-random-secret
```

Set `MAE_SEARCH_API_KEY` for research. Start Mae with:

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080), create an account, and
sign in. The API health endpoint does not require authentication:

```bash
curl http://localhost:8080/api/health
```

Expected response:

```json
{"status":"ok"}
```

Run in the background and inspect API logs with:

```bash
docker compose up --build -d
docker compose logs -f mae-api
```

Stop the stack with:

```bash
docker compose down
```

Add `-v` only when you intentionally want to delete the Postgres, Redis, and
Mae data volumes.

## Database Schema

Alembic migrations are the production schema source of truth. Apply them after
the API container is running:

```bash
docker compose exec mae-api alembic upgrade head
```

The API also creates missing tables during startup for development
convenience. Do not use that startup behavior as a replacement for migrations
in a production deployment.

## Configuration

All settings use the `MAE_` prefix and are listed in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `MAE_OPENROUTER_API_KEY` | Default server-side model provider key |
| `MAE_OPENROUTER_BASE_URL` | OpenRouter-compatible API base URL |
| `MAE_DEFAULT_MODEL` | Default chat model |
| `MAE_COUNCIL_MODELS` | Comma-separated default council models |
| `MAE_SEARCH_API_KEY` | Search provider key for research |
| `MAE_DATABASE_URL` | Async PostgreSQL connection URL |
| `MAE_REDIS_URL` | Redis connection URL |
| `MAE_ENCRYPTION_KEY` | Encrypts account provider keys; use a long random value |
| `MAE_COOKIE_SECURE` | Set to `true` when serving over HTTPS |
| `MAE_SESSION_TTL_DAYS` | Session lifetime |
| `MAE_RATE_LIMIT_PER_MINUTE` | Application rate limit |

In the supplied Compose file, Postgres and Redis are internal services. The
Compose environment overrides their connection URLs for the API and worker.

## API Reference

When the stack is running, FastAPI exposes:

- Swagger UI: [http://localhost:8080/docs](http://localhost:8080/docs)
- ReDoc: [http://localhost:8080/redoc](http://localhost:8080/redoc)
- OpenAPI JSON: [http://localhost:8080/openapi.json](http://localhost:8080/openapi.json)

The main API areas are:

- `/api/auth/*`: account and session operations
- `/api/account/*`: account provider-key operations
- `/api/chat`: authenticated streaming chat
- `/api/conversations/*`: conversation history management
- `/api/councils/*`: council configuration and council jobs
- `/api/research`: research job creation
- `/api/documents`: document job creation
- `/api/jobs/*`: job status, progress streams, and generated files
- `/api/automation/*`: schedules and automation runs
- `/api/models`: available model information

Mutating authenticated requests use the application's CSRF protection. The
browser UI handles the normal session and request flow.

## Local Frontend Verification

The frontend is a React/TypeScript/Vite application in `frontend/`:

```bash
cd frontend
npm install
npm run build
```

The production frontend is built by `frontend/Dockerfile` and served by nginx.
For local development, use the Vite development server and configure its API
proxy as defined in `frontend/vite.config.ts`.

## Repository Layout

```text
backend/app/       FastAPI routes, services, models, workers, and settings
backend/alembic/   Database migrations
backend/renderer/  Isolated document renderer image
backend/sandbox/   Isolated sandbox image
frontend/          React/TypeScript application
docs/              User, architecture, and operations documentation
.env.example       Safe configuration template
docker-compose.yml Local deployment stack
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Features](docs/features.md)
- [Architecture](docs/architecture.md)
- [Operations](docs/operations.md)

## Security Notes

- Never commit `.env` or any real API key.
- Keep `MAE_ENCRYPTION_KEY` stable after storing account provider keys; changing
  it makes existing encrypted keys unreadable.
- Set `MAE_COOKIE_SECURE=true` behind HTTPS.
- Change default database credentials before exposing the stack beyond a local
  development environment.
- Back up Postgres and the named Mae volumes before upgrades or migrations.

## Project Status

Mae is under active development. The API and configuration may change between
releases.
