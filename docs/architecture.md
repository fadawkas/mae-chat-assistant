# Architecture

## Request Paths

`mae-web` serves the React application through nginx and proxies `/api` to
`mae-api`.

Interactive chat uses `POST /api/chat` and a server-sent event stream. It does
not use the job queue. Work that must continue after the HTTP request, such as
research or document generation, is persisted as a job and sent to Redis.

## Services

- `mae-api`: FastAPI routes, authentication, database access, and chat
  streaming.
- `mae-worker`: ARQ worker using the same backend codebase; handles councils,
  research, documents, and automation.
- `postgres`: durable users, conversations, messages, councils, schedules,
  jobs, and document metadata.
- `redis`: ARQ queue, scheduling support, and job progress pub/sub.
- `mae-renderer`: restricted document rendering container.
- `mae-sandbox`: restricted workspace execution container.
- `mae-web`: production frontend image and reverse proxy.

## Data and Isolation

Postgres and Redis use named Compose volumes. Generated files and workspaces
use separate named volumes. Renderer and sandbox containers are restricted with
read-only filesystems, dropped capabilities, resource limits, and an internal
network.

## API Areas

- `/api/auth/*`: signup, signin, signout, and current user
- `/api/account/*`: account provider-key management
- `/api/chat`: streaming chat
- `/api/conversations/*`: conversation persistence
- `/api/councils/*`: council configuration and execution
- `/api/research`: research jobs
- `/api/documents`: document jobs
- `/api/jobs/*`: job status, progress, and files
- `/api/automation/*`: schedules and runs
- `/api/models`: model listing
