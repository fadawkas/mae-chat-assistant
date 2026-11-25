# Architecture

## Request Paths

`mae-web` serves the React application through nginx and proxies `/api` to
`mae-api`.

Interactive chat commits the user message and a queued job together before
dispatching to ARQ. The client supplies a run UUID so retrying the same
submission cannot add another turn. Only one run can be active per conversation.
The worker reads conversation history from Postgres, saves cumulative text and
progress snapshots, and commits the final job state with the assistant message.
Clients poll the snapshot after submitting or reopening a conversation. These
snapshots restore the latest output and files, not every individual token event.

Closing the tab only ends observation. Stop marks the run cancelled, preserves
saved output, and the worker stops consuming it on its next status check. A
reconciler dispatches stranded queued runs using deterministic queue IDs. It
marks stale running jobs interrupted rather than replaying their effects.

A routine stores a prompt and scheduling settings;
manual and scheduled runs queue the same agent in ARQ. Council, research, and
advanced document workflows keep their existing job paths.

## Automatic Effort

Liquid d1-ultra classifies the task via OpenRouter's Decisions API. Mae uses
that choice (`none`, `low`, or `high`) for DeepSeek V4.1 Flash 1017 throughout the
run and falls back to `low` if routing is unavailable. Reasoning from tool
rounds stays in memory for provider replay; it is not saved or shown in chat.

Complex or tool-assisted work gets a separate completion check against the
user's request and tool receipts. A proposed answer is not shown until it
passes. Mae retries recoverable gaps within task-sized budgets, does not
re-execute already successful identical calls, and marks unverified work
incomplete. Browser spreadsheet requests require a committed workbook.

## Voice and Browser Helper

Dictation and read-aloud use the browser's Web Speech API. Dictation creates
an editable draft; it does not submit. A browser may use a remote speech
service. Typed chat works without microphone permission.

The [Browser Helper](../browser-helper/README.md) reads only a selected visible
HTML table, after an explicit local click and a one-run grant. It does not
provision a computer or expose screen capture, shell, filesystem, or browser
write actions. A missing helper leaves Mae waiting before any model call;
expiry or local revocation marks the run incomplete. Raw tab rows and the
grant digest are cleared from the job at finish. The selected text may go to
the configured model provider. Native desktop access is not implemented.

## Code Mode

The model has one tool, `execute_code`. It runs bounded synchronous
JavaScript in a fresh QuickJS context on `mae-code`. Snippets can compute and
return JSON, or compose file operations with `mae.writeFile`, `mae.document`,
and `mae.spreadsheet`. There are no host bindings or filesystem, network, or
credential APIs. The runner has its own internal network and no output volume.

Mae validates the returned file descriptions and renders structured documents
with existing libraries. The model receives execution results and can correct
a failed attempt before replying. Runs have time, execution, and file limits.
Only committed files are emitted as artifacts. Files and metadata are backed
by the existing output volume and job artifact records, with owner checks on
listing and downloading.

## Services

- `mae-api`: FastAPI routes, authentication, database access, and chat snapshots.
- `mae-worker`: ARQ worker using the same backend codebase; handles chat,
  councils, research, advanced documents, and routines.
- `postgres`: durable users, conversations, messages, councils, schedules,
  jobs, and document metadata.
- `redis`: ARQ queue, scheduling support, and job progress pub/sub.
- `mae-code`: restricted QuickJS runner for workspace chat and routines.
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
- `POST /api/chat`: submit a worker run
- `GET /api/chat/{conversation_id}`: observe the latest or a specified run
- `POST /api/chat/{run_id}/stop`: stop a run
- `/api/conversations/*`: conversation persistence
- `/api/councils/*`: council configuration and execution
- `/api/research`: research jobs
- `/api/documents`: document jobs
- `/api/jobs/*`: job status and progress
- `/api/artifacts` and `/api/files/*`: account-scoped library and downloads
- `/api/automation/*`: routines, legacy schedules, and runs
- `/api/models`: model listing
