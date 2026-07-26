# Getting Started

Mae runs as a Docker Compose application with a React frontend, FastAPI API,
Postgres database, Redis queue, worker, renderer, and sandbox services.

## Requirements

- Docker Engine with Docker Compose
- OpenRouter API key
- Search API key for research features

## Setup

```bash
git clone https://github.com/YOUR-USERNAME/MAE.git
cd MAE
cp .env.example .env
```

Set `MAE_OPENROUTER_API_KEY` and a long random `MAE_ENCRYPTION_KEY` in `.env`.
Set `MAE_SEARCH_API_KEY` if research is required.

Start the application:

```bash
docker compose up --build
```

Open `http://localhost:8080`, create an account, and sign in. Check the API
without authentication with:

```bash
curl http://localhost:8080/api/health
```

The expected response is `{"status":"ok"}`.

To run in the background:

```bash
docker compose up --build -d
docker compose logs -f mae-api
```

Stop the services with `docker compose down`. Do not use `docker compose down
-v` unless you intend to delete application data.

## Database

Apply the canonical migrations after the API is running:

```bash
docker compose exec mae-api alembic upgrade head
```

The API creates missing tables during startup for development convenience, but
production deployments should apply and track Alembic migrations explicitly.
