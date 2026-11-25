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

## Browser and voice smoke test

Use a Chromium profile you control and follow the [helper setup](../browser-helper/README.md).
On the same machine, serve the permitted test page from the repository root:

```bash
python3 -m http.server 8095 --bind 127.0.0.1 --directory backend/tests/fixtures
```

1. Open `http://127.0.0.1:8095/browser_inventory.html`. In a Mae chat tab,
   click **Dictate message**, allow the microphone, and say “Save the selected
   inventory table as a spreadsheet.” Confirm it stays in an editable draft.
2. Select **Use a table from my browser** and send. Get the grant code, open
   the helper on the fixture tab, and share **Inventory**. Only the visible
   table should be selectable. Close the Mae chat tab while the worker is active.
3. Reopen the conversation. Confirm there is exactly one workbook with the
   `Item` and `Count` headers and two rows, Apples (12) and Pears (8). Use
   **Read aloud** and check that speech starts only when requested.
4. Repeat with microphone permission denied; typed chat must still work.
   For a browser run, close the helper before sharing and confirm that Mae
   does not start model work and eventually reports missing browser data.
   In a separate run, use **Revoke run access** in the helper and confirm
   that Mae stops without starting another browser action.

Use a disposable deployment when testing worker crashes. The integration
suite in `backend/tests/test_durable_chat.py` uses `MAE_TEST_CHAT_INTEGRATION=1`
with disposable Postgres and Redis instances. This suite is separate from the
physical microphone check.

## Optional Office editor

Artifacts can embed ONLYOFFICE Docs Community Edition for Word, Excel, and
PowerPoint editing. Review the [Community Edition terms and requirements](https://helpcenter.onlyoffice.com/docs/installation/community/docker/installing/install)
before deploying. Add a separate random secret for the integration to Mae's
local `.env`:

```bash
printf 'MAE_OFFICE_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
docker compose -f docker-compose.yml -f docker-compose.office.yml up --build -d
```

Only add the secret once; keep it stable across restarts. The editor is served
on loopback at `http://localhost:8081`. Use the same `-f` flags for stop, logs, and
upgrade operations. The Office container reaches Mae over a private Docker
network; do not publish the API or its `/office-internal/*` paths. For remote
use, serve the Office proxy on a separate trusted HTTPS hostname and set
`MAE_OFFICE_PUBLIC_URL` to that origin. Do not point this setting at a
third-party server: Mae loads its editor script in the browser.

## Upgrades

Pull the new source, stop the API and worker, and apply migrations before
starting the updated services:

```bash
git pull
docker compose stop mae-api mae-worker
docker compose run --rm --build mae-api alembic upgrade head
docker compose up --build -d
```

Back up existing data and review migration files before upgrading. Revision
`008_multi_user_accounts` intentionally resets pre-multi-user application data.
If a development database was created by API startup without Alembic, do not
assume it can be upgraded in place or stamp it as current without checking its
schema.

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
