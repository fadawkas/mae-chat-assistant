# Mae

Mae is a self-hosted AI workspace. Ask the workspace agent to answer a
question, compute a result, or create files in chat. Save repeatable prompts as
**Routines** and find generated files in **Artifacts**.

## What Is Included

- Account signup, sign-in, sign-out, and session-based authentication
- Durable conversations with DeepSeek V4.1 Flash 1017, automatic reasoning effort, and evidence-based completion checks
- Click-to-dictate drafts and optional read-aloud in supported browsers
- [Mae Browser Helper](browser-helper/README.md) for sharing a selected table from your own Chromium profile, without a hosted desktop
- Isolated JavaScript code mode for calculations and file generation
- Text-to-image generation in chat using Recraft V4.1 Flash V2 and your OpenRouter credits
- Private Artifacts library for documents, spreadsheets, text files, and generated images
- Saved Routines using the same agent, with manual and scheduled runs
- Advanced document tools
- Job status and progress streaming through Redis pub/sub
- Per-account OpenRouter key storage encrypted with `MAE_ENCRYPTION_KEY`

## Runtime Services

Mae runs as a Docker Compose stack:

| Service | Role |
| --- | --- |
| `mae-web` | React frontend and nginx API proxy on port `8080` |
| `mae-api` | FastAPI HTTP API and chat run endpoints |
| `mae-worker` | ARQ worker for chat, routines, councils, research, and advanced document jobs |
| `postgres` | Users, conversations, jobs, councils, schedules, and metadata |
| `redis` | ARQ queue and job progress pub/sub |
| `mae-code` | Isolated JavaScript execution for the workspace agent |
| `mae-renderer` | Isolated rendering for advanced document jobs |
| `mae-sandbox` | Isolated execution for legacy document workflows |

Chat runs in `mae-worker`, with its state stored in Postgres and dispatch
through Redis. You can leave a conversation while Mae works and reopen it to
see the latest result. Use **Stop** to cancel; closing the tab does not cancel.

## Run With Docker Compose

### Prerequisites

- Docker Engine with Docker Compose
- An OpenRouter API key

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

Apply migrations before starting Mae on a new database:

```bash
docker compose run --rm --build mae-api alembic upgrade head
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080), create an account, and
add your OpenRouter key in account settings. Try asking Mae to calculate a
budget and generate a spreadsheet, or ask it to create an image. Generated images
appear in chat and in **Artifacts**. Mae generates up to five images per explicit chat
request; image generation is not available in scheduled Routines.

The API health endpoint does not require authentication:

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

Alembic migrations are the production schema source of truth. Apply them in a
one-off API container before starting the updated API and worker:

```bash
docker compose run --rm --build mae-api alembic upgrade head
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
| `MAE_DEFAULT_MODEL` | Default model for legacy server workflows |
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
- `/api/chat`: submit, observe, and stop authenticated chat runs
- `/api/conversations/*`: conversation history management
- `/api/councils/*`: council configuration and council jobs
- `/api/research`: research job creation
- `/api/documents`: document job creation
- `/api/jobs/*`: job status and progress streams
- `/api/artifacts` and `/api/files/*`: private file library and downloads
- `/api/automation/*`: saved routines, legacy schedules, and background runs
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
backend/sandbox/   Legacy document sandbox image
backend/codemode/  Isolated JavaScript runner image
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
