# Operations

## Logs and Health

```bash
docker compose ps
docker compose logs -f mae-api
docker compose logs -f mae-worker
curl http://localhost:8080/api/health
```

FastAPI documentation is available at `/docs`, `/redoc`, and
`/openapi.json` while the stack is running.

## Upgrades

Pull the new source, rebuild images, and apply migrations:

```bash
git pull
docker compose up --build -d
docker compose exec mae-api alembic upgrade head
```

Review migration files before applying them to production data.

## Backups

Back up Postgres and the named volumes containing generated files, uploads, and
workspaces. Keep `MAE_ENCRYPTION_KEY` with the backup; encrypted account keys
cannot be recovered without it.

## Production Checklist

- Serve Mae behind HTTPS and set `MAE_COOKIE_SECURE=true`.
- Replace default Postgres credentials and use production secret values.
- Keep `.env` outside version control.
- Restrict access to port `8080` with a reverse proxy or firewall.
- Apply Alembic migrations explicitly.
- Back up Postgres and persistent Mae volumes.
- Monitor API, worker, Postgres, and Redis health.
