# Mae

Mae is a self-hosted AI workspace for chat, research, multi-model councils,
document generation, and scheduled automation. It runs as a Docker Compose
stack and uses OpenRouter for model access.

## Features

- Streaming AI chat with persistent conversations
- Multi-model councils that compare responses and produce a judged result
- Research workflows with search and synthesized reports
- Document generation for DOCX, PPTX, PDF, and XLSX files
- Scheduled automation jobs
- User accounts, sessions, rate limiting, and encrypted provider keys
- Persistent Postgres data and Redis-backed background jobs

## Architecture

Mae is split into an interactive HTTP lane and a background-job lane:

```text
Browser -> mae-web (nginx) -> mae-api (FastAPI) -> OpenRouter
                                      |
                              Postgres + Redis/ARQ
                                      |
                                  mae-worker
                              /       |       \
                         research  documents  automation
```

The Compose stack includes:

| Service | Purpose |
| --- | --- |
| `mae-web` | React/TypeScript frontend and nginx reverse proxy |
| `mae-api` | FastAPI API and streaming chat endpoint |
| `mae-worker` | ARQ worker for research, councils, documents, and automation |
| `postgres` | Persistent application data |
| `redis` | Job queue, scheduling, and progress pub/sub |
| `mae-renderer` | Isolated document rendering service |
| `mae-sandbox` | Isolated workspace execution service |

## Requirements

- Docker Engine with Docker Compose
- An [OpenRouter](https://openrouter.ai/) API key
- A search API key if research features are used

The documented deployment path is Docker Compose on Linux. Node.js and Python
are only needed for local frontend or backend development.

## Quick Start

Clone the repository and enter it:

```bash
git clone https://github.com/YOUR-USERNAME/MAE.git
cd MAE
```

Create the local environment file:

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
MAE_OPENROUTER_API_KEY=your-openrouter-key
MAE_ENCRYPTION_KEY=generate-a-long-random-secret
```

Set `MAE_SEARCH_API_KEY` as well if you plan to use research workflows. Then
build and start the stack:

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). The API health check is:

```bash
curl http://localhost:8080/api/health
```

Expected response:

```json
{"status":"ok"}
```

Stop the stack with `Ctrl+C`, or run it in the background with:

```bash
docker compose up --build -d
docker compose logs -f mae-api
```

## Database Migrations

Application startup creates missing tables and applies a small set of
development compatibility changes. Alembic migrations are the canonical schema
source for production deployments:

```bash
docker compose exec mae-api alembic upgrade head
```

## Local Frontend Development

The frontend lives in `frontend/` and uses React, TypeScript, Vite, and
Tailwind CSS. Install dependencies and run the available build verification:

```bash
cd frontend
npm install
npm run build
```

The frontend API is normally accessed through the Compose nginx proxy at
`http://localhost:8080`.

## Configuration

All application settings use the `MAE_` prefix and are documented in
`.env.example`. Important settings include:

- `MAE_DEFAULT_MODEL`: default OpenRouter model
- `MAE_COUNCIL_MODELS`: comma-separated council models
- `MAE_SEARCH_API_KEY`: search provider key for research
- `MAE_DATABASE_URL`: Postgres connection URL
- `MAE_REDIS_URL`: Redis connection URL
- `MAE_ENCRYPTION_KEY`: secret used to encrypt stored provider keys
- `MAE_COOKIE_SECURE`: set to `true` when serving over HTTPS

Never commit `.env`, API keys, session secrets, generated files, or uploaded
documents. Use `.env.example` for safe configuration documentation.

## API

The FastAPI OpenAPI documentation is available when the stack is running:

- Swagger UI: [http://localhost:8080/docs](http://localhost:8080/docs)
- ReDoc: [http://localhost:8080/redoc](http://localhost:8080/redoc)
- OpenAPI JSON: [http://localhost:8080/openapi.json](http://localhost:8080/openapi.json)

Interactive chat is exposed as a server-sent event stream. Longer-running
council, research, document, and automation work is queued through Redis and
reports job progress through the API.

## Project Layout

```text
backend/       FastAPI application, workers, migrations, renderer, sandbox
frontend/      React/TypeScript application
docs/          System design and project documentation
.env.example   Safe environment configuration template
```

## Status

Mae is under active development. Interfaces, configuration names, and features
may change between releases.

## License

This project is distributed under the MIT License. See `LICENSE` for the full
text.
