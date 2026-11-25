from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy import text

from app.core.database import engine, async_session_factory
from app.services.openrouter import OpenRouterClient
from app.models import Session
from app.core.auth import COOKIE
import hashlib
import logging
import re
from datetime import datetime, timezone
from app.core.rate_limit import check_rate_limit
from app.api.router import api_router
from app.api.routes.office import RedactOfficeTickets

logging.getLogger("uvicorn.access").addFilter(RedactOfficeTickets())


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: apply schema changes that Alembic handles offline.
    #
    # Base.metadata.create_all handles *new* tables but not column
    # additions to existing tables.  We run ALTER TABLE IF NOT EXISTS
    # for those here so the app works without running `alembic upgrade
    # head` manually.
    #
    # (Alembic migrations are still the canonical source of truth for
    # production deployments; this is a convenience for dev startup.)
    async with engine.begin() as conn:
        from app.core.database import Base
        from app.models import Conversation, Council, CouncilMember, Message, Job, User, Session, AutomationSchedule, DocumentArtifactRecord  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)

        # Add columns added by migration 003+ if they don't exist yet.
        await conn.execute(
            text(
                "ALTER TABLE jobs "
                "ADD COLUMN IF NOT EXISTS council_id UUID "
                "REFERENCES councils(id) ON DELETE SET NULL"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE councils "
                "ADD COLUMN IF NOT EXISTS judge_model TEXT"
            )
        )
    yield
    # Shutdown: close the shared HTTPX client
    pass


app = FastAPI(title="Mae API", version="0.1.0", lifespan=lifespan)

# Shared httpx client — created once, never closed per-request.

@app.middleware("http")
async def require_session(request, call_next):
    if request.url.path in {"/api/health", "/docs", "/openapi.json", "/redoc"}:
        return await call_next(request)
    if request.method in {"PUT", "DELETE"} and re.fullmatch(
        r"/api/browser-grants/[0-9a-fA-F-]{36}", request.url.path,
    ):
        # This single-purpose input endpoint authenticates a one-run bearer grant.
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        costly = request.url.path in {"/api/chat", "/api/council", "/api/research", "/api/documents"}
        auth_path = request.url.path in {"/api/auth/signup", "/api/auth/signin"}
        if costly or auth_path:
            principal = request.client.host if auth_path and request.client else hashlib.sha256(request.cookies.get(COOKIE, request.client.host if request.client else "unknown").encode()).hexdigest()
            allowed, retry_after = await check_rate_limit(f"{'auth' if auth_path else 'costly'}:{principal}", 10 if auth_path else 30)
            if not allowed:
                return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429, headers={"Retry-After": str(retry_after)})
        token = request.cookies.get(COOKIE)
        valid = False
        if token:
            async with async_session_factory() as db:
                session = await db.scalar(select(Session).where(Session.token_hash == hashlib.sha256(token.encode()).hexdigest()))
                valid = bool(session and session.expires_at > datetime.now(timezone.utc))
        if not valid and request.url.path not in {"/api/auth/signup", "/api/auth/signin"}:
            return JSONResponse({"detail": "Authentication required"}, status_code=401)
    return await call_next(request)

app.include_router(api_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
