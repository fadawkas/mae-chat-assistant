# Configuration

Mae reads settings from `.env` using the `MAE_` prefix. Start from
`.env.example`; never commit `.env`.

## Provider Settings

| Variable | Description |
| --- | --- |
| `MAE_OPENROUTER_API_KEY` | Server-side OpenRouter key |
| `MAE_OPENROUTER_BASE_URL` | OpenRouter-compatible API URL |
| `MAE_DEFAULT_MODEL` | Default model for legacy server workflows |
| `MAE_COUNCIL_MODELS` | Comma-separated default council models |
| `MAE_SEARCH_API_KEY` | Search provider key for research |

Users may also store an account-specific OpenRouter key. Mae encrypts those
keys using `MAE_ENCRYPTION_KEY`. Workspace runs use DeepSeek V4.1 Flash 1017 and
Liquid d1-ultra through the same OpenRouter key.

## Services and Storage

| Variable | Description |
| --- | --- |
| `MAE_DATABASE_URL` | Async PostgreSQL URL |
| `MAE_REDIS_URL` | Redis URL for jobs and progress events |
| `MAE_OUTPUT_DIR` | Generated file directory |
| `MAE_UPLOAD_DIR` | Uploaded file directory |
| `MAE_MAX_UPLOAD_BYTES` | Maximum upload size |
| `MAE_CODE_RUNNER_URL` | Internal workspace code runner URL (default `http://mae-code:9200`) |
| `MAE_SANDBOX_URL` | Internal legacy document sandbox service URL |
| `MAE_RENDERER_URL` | Internal renderer service URL |
| `MAE_SANDBOX_TIMEOUT_SECONDS` | Sandbox execution timeout |

Compose overrides the database, Redis, and sandbox URLs so containers can reach
one another by service name.

## Security and Sessions

| Variable | Description |
| --- | --- |
| `MAE_ENCRYPTION_KEY` | Stable, long random key for encrypted provider keys |
| `MAE_SESSION_TTL_DAYS` | Session lifetime |
| `MAE_COOKIE_SECURE` | Set `true` when served over HTTPS |
| `MAE_RATE_LIMIT_PER_MINUTE` | General application rate limit |

Changing `MAE_ENCRYPTION_KEY` makes existing encrypted provider keys unusable.
Use different database credentials and secrets before exposing Mae beyond a
local development environment.
