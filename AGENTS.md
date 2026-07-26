# MAE Agent Guide

## Skill Routing

Load only the skills relevant to the current task.

- For any code implementation or file modification, load `senior-engineering`.
- For UI design, styling, responsiveness, accessibility, or React component   work, load both `frontend-ui` and `senior-engineering`.
- For a concrete error, failing build, regression, or broken behavior, load  `debugging` together with the relevant domain skill.
- For reviewing, refactoring, cleaning, or improving existing code, load  `code-review`. Also load `senior-engineering` when applying changes.
- For Docker Compose, Dockerfiles, container logs, container shells, or   container networking, load `docker-workflow`.
- Do not load every skill automatically.


## Run And Verify

- The supported full stack is Docker Compose: copy `.env.example` to `.env`, set the required OpenRouter key (and `MAE_SEARCH_API_KEY` for research), then run `docker compose up --build`. The web app and proxied API are available at `http://localhost:8080`; `/api/health` is the smoke check.
- Compose runs PostgreSQL and Redis only on its internal network. The API and ARQ worker share `backend/app`; do not expect direct local backend or Vite development to reach those services without separately providing reachable URLs/proxying.
- Frontend verification is `npm run build` from `frontend/`; it runs `tsc -b` before Vite. No repository-owned test, lint, or backend typecheck command is configured.
- Apply schema migrations explicitly with `docker compose exec mae-api alembic upgrade head`. API startup creates missing tables and a few compatibility columns, but migrations in `backend/alembic/versions/` remain the production schema source of truth.

## Architecture Constraints

- `backend/app/main.py` is the FastAPI entrypoint; `backend/app/api/router.py` aggregates all routes. Add HTTP routes there through the appropriate module in `backend/app/api/routes/`.
- Register every ARQ task in `backend/app/workers/worker.py`. Council and research endpoints create durable `Job` rows, enqueue ARQ work, and stream Redis pub/sub progress from `/api/jobs/{job_id}/stream`.
- Keep interactive chat on `POST /api/chat` as a FastAPI SSE stream, not an ARQ task. Preserve the JSON `data: ...\n\n` framing and nginx's unbuffered `/api` proxy settings when changing streaming behavior.
- Put shared settings in `backend/app/core/config.py`; they load `.env` using the `MAE_` prefix. Never expose `.env` contents or real keys.
- Saved council configuration is resolved into the queued payload before enqueueing so a worker does not query live council configuration. Retain that self-contained-job behavior.

## Frontend Contract

- The React entrypoint is `frontend/src/main.tsx`; `src/app/App.tsx` composes feature panels, while API helpers live in `src/api/` and shared API shapes are manually mirrored in `src/types/index.ts`.
- `npm run codegen` calls the API through `http://localhost:8080` and writes `src/api/client.ts`, but the current UI uses the hand-maintained types and helpers. Update those alongside Pydantic schema/API changes; do not assume generated types are consumed.

## Documentation

- `docs/mae-system-design.md` and `docs/progress.md` describe earlier layouts and phases. Use the executable configuration and current `backend/app` structure as the source of truth when they conflict.

Before finishing an implementation:

1. Run the most relevant existing verification command.
2. Report commands that were run and their outcomes.
3. State clearly when verification could not be completed.
4. Summarize the files changed and the reason for each change.
5. Do not commit, push, or perform destructive Git operations unless explicitly
   requested.