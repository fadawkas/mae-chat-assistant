# Getting Started

Mae runs as a Docker Compose application with a React frontend, FastAPI API,
Postgres database, Redis queue, worker, isolated code runner, and document services.

## Requirements

- Docker Engine with Docker Compose
- OpenRouter API key

## Setup

```bash
git clone https://github.com/YOUR-USERNAME/MAE.git
cd MAE
cp .env.example .env
```

Set `MAE_OPENROUTER_API_KEY` and a long random `MAE_ENCRYPTION_KEY` in `.env`.

Apply migrations, then start the application:

```bash
docker compose run --rm --build mae-api alembic upgrade head
docker compose up --build
```

Open `http://localhost:8080`, create an account, and add an OpenRouter key in
account settings. Mae chooses reasoning effort automatically. Try asking
Mae to create a document, then open **Artifacts** to download it.

Check the API without authentication with:

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

Apply the canonical migrations before starting the API and worker:

```bash
docker compose run --rm --build mae-api alembic upgrade head
```

The API creates missing tables during startup for development convenience, but
production deployments should apply and track Alembic migrations explicitly.
