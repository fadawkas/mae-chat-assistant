# Features

## Chat and Conversations

The Chat view sends prompts to `/api/chat` and renders the response as a
stream. Messages and conversations are persisted in Postgres. Conversations
can be created, listed, renamed, loaded, and deleted.

## Councils

A council sends one prompt to several configured models, reports member
progress, and asks a judge model to synthesize the result. Council
configurations can be created, listed, updated, and deleted. Council work runs
as a background job and remains available if the browser disconnects.

## Research

Research requests run as background jobs. The worker uses the configured search
provider, gathers source material, and produces a synthesized report. A valid
`MAE_SEARCH_API_KEY` is required.

## Documents

Document jobs use the worker and isolated renderer to produce DOCX, PPTX, PDF,
or XLSX artifacts. Generated files are stored in the configured output volume
and can be downloaded through the jobs API.

## Automation

Schedules are managed through the application. Each schedule has a cron
expression and timezone, and can be run manually. Scheduled work is executed
by the ARQ worker and recorded as jobs.

## Jobs

Long-running council, research, document, and automation operations return a
job ID. The application can list jobs, retrieve status, stream progress, and
delete jobs. Redis pub/sub carries live progress while Postgres stores durable
job state.
