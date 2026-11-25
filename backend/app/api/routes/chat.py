import asyncio
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.auth import current_user, require_csrf, user_openrouter_key
from app.core.database import async_session_factory
from app.models import Conversation, Job, Message, User
from app.schemas import ChatRunRequest, ChatRunSnapshot, JobEnqueueResponse
from app.services.browser_grants import BrowserTable, browser_run, grant_matches, new_grant
from app.services.chat_runs import ACTIVE, CHAT_JOB, browser_state, chat_snapshot, conversation_runs, enqueue_chat, finish_chat
from app.workers.queue import get_arq_redis

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/chat", status_code=202, response_model=JobEnqueueResponse, dependencies=[Depends(require_csrf)])
async def chat(request: ChatRunRequest, user: User = Depends(current_user)):
    """Commit a conversation turn before making it eligible for dispatch."""
    if not request.content.strip():
        raise HTTPException(400, "A user message is required")
    async with async_session_factory() as db:
        conversation = await db.get(Conversation, request.conversation_id, with_for_update={"key_share": True})
        if conversation is None or conversation.owner_id != user.id:
            raise HTTPException(404, "Conversation not found")
        runs = conversation_runs(conversation.id, user.id)
        existing = await db.scalar(runs.where(Job.id == request.run_id))
        if existing is not None:
            message = await db.get(Message, UUID(existing.payload["user_message_id"]))
            if (message is None or message.content != request.content
                    or existing.payload.get("use_browser_tab", False) != request.use_browser_tab):
                raise HTTPException(409, "This run ID already belongs to another message")
            return {"job_id": existing.id}
        if await db.scalar(runs.where(Job.status.in_(ACTIVE)).limit(1)) is not None:
            raise HTTPException(409, "This conversation already has an active run")
        if await db.get(Job, request.run_id) is not None:
            raise HTTPException(409, "This run ID is unavailable")
        await user_openrouter_key(user)
        message_id = uuid4()
        db.add(Message(id=message_id, conversation_id=conversation.id, role="user", content=request.content))
        db.add(Job(
            id=request.run_id, owner_id=user.id, type=CHAT_JOB, status="queued",
            payload={"conversation_id": str(conversation.id), "user_message_id": str(message_id),
                     "use_browser_tab": request.use_browser_tab},
        ))
        if conversation.title == "New Chat":
            conversation.title = " ".join(request.content.split())[:80]
        try:
            await db.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "This run ID is unavailable") from exc

    try:
        async with asyncio.timeout(2):
            redis = await get_arq_redis()
            try:
                await enqueue_chat(redis, request.run_id)
            finally:
                await redis.aclose()
    except Exception:
        # The worker's reconciler dispatches committed jobs that missed enqueue.
        logger.warning("Immediate dispatch failed for chat %s", request.run_id, exc_info=True)
    return {"job_id": request.run_id}


@router.get("/api/chat/{conversation_id}", response_model=ChatRunSnapshot | None)
async def get_chat_run(conversation_id: UUID, run_id: UUID | None = None, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        conversation = await db.get(Conversation, conversation_id, with_for_update={"read": True})
        if conversation is None or conversation.owner_id != user.id:
            raise HTTPException(404, "Conversation not found")
        query = conversation_runs(conversation_id, user.id)
        if run_id is not None:
            query = query.where(Job.id == run_id)
        job = await db.scalar(query.order_by(Job.created_at.desc(), Job.id.desc()).limit(1))
        return await chat_snapshot(db, job) if job else None


@router.post("/api/chat/{run_id}/stop", status_code=204, dependencies=[Depends(require_csrf)])
async def stop_chat_run(run_id: UUID, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        job = await db.scalar(select(Job).where(
            Job.id == run_id, Job.owner_id == user.id, Job.type == CHAT_JOB,
        ).with_for_update())
        if job is None:
            raise HTTPException(404, "Chat run not found")
        await finish_chat(db, job, "cancelled", error="Stopped. Any saved files are available in Artifacts.")


@router.post("/api/chat/{run_id}/browser-grant", dependencies=[Depends(require_csrf)])
async def issue_browser_grant(run_id: UUID, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        job = await db.scalar(browser_run(run_id).where(Job.owner_id == user.id))
        if job is None:
            raise HTTPException(404, "Chat run not found")
        if job.status not in ACTIVE or browser_state(job) != "waiting":
            raise HTTPException(409, "This run is not waiting for a browser helper")
        code, digest = new_grant(run_id)
        job.payload = {**job.payload, "browser_secret": digest}
        await db.commit()
        return {"code": code}


@router.put("/api/browser-grants/{run_id}", status_code=204)
async def receive_browser_table(run_id: UUID, table: BrowserTable, authorization: str = Header(default="")):
    async with async_session_factory() as db:
        job = await db.scalar(browser_run(run_id))
        if job is None or not grant_matches(run_id, authorization, job.payload.get("browser_secret", "")):
            raise HTTPException(404, "Browser grant not found")
        if job.status not in ACTIVE or browser_state(job) != "waiting":
            raise HTTPException(409, "This grant is no longer waiting for data")
        job.payload = {**job.payload, "browser_state": "received", "browser_observation": table.observation()}
        await db.commit()


@router.delete("/api/browser-grants/{run_id}", status_code=204)
async def revoke_browser_grant(run_id: UUID, authorization: str = Header(default="")):
    async with async_session_factory() as db:
        job = await db.scalar(browser_run(run_id))
        if job is None or not grant_matches(run_id, authorization, job.payload.get("browser_secret", "")):
            raise HTTPException(404, "Browser grant not found")
        if job.status in ACTIVE:
            await finish_chat(db, job, "incomplete", error="Browser access was revoked. Any saved files remain in Artifacts.")
