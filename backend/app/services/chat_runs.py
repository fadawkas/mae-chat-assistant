"""Durable chat execution. Postgres is authoritative; Redis only dispatches work."""

import asyncio
import logging
from contextlib import aclosing
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models import Conversation, DocumentArtifactRecord, Job, Message
from app.services.agent import run_agent
from app.services.completion import AgentIncomplete
from app.services.artifacts import IMAGE_CONTENT_TYPES, describe_artifact
from app.services.openrouter import WORKSPACE_MODEL
from app.workers.context import job_owner_and_key

logger = logging.getLogger(__name__)
CHAT_JOB = "chat"
ACTIVE = ("queued", "in_progress")
RUN_TIMEOUT = 175
BROWSER_WAIT_TIMEOUT = 75
INTERRUPTED = "Mae was interrupted. Check any saved files before trying again."


def conversation_runs(conversation_id: UUID, owner_id: UUID):
    return select(Job).where(
        Job.type == CHAT_JOB, Job.owner_id == owner_id,
        Job.payload["conversation_id"].as_string() == str(conversation_id),
    )


async def enqueue_chat(redis, run_id: UUID) -> None:
    await redis.enqueue_job("chat_job", str(run_id), _job_id=f"chat:{run_id}")


async def chat_snapshot(db, job: Job) -> dict:
    records = await db.scalars(select(DocumentArtifactRecord).where(
        DocumentArtifactRecord.job_id == job.id, DocumentArtifactRecord.role == "output",
    ).order_by(DocumentArtifactRecord.created_at, DocumentArtifactRecord.id))
    user = await db.get(Message, UUID(job.payload["user_message_id"]))
    return {
        "id": job.id, "status": job.status, "error": job.error,
        "user_message_id": user.id, "user_content": user.content,
        "browser_state": browser_state(job) if job.status in ACTIVE else None,
        "content": (job.result or {}).get("content", ""),
        "progress": (job.result or {}).get("progress"),
        "artifacts": [describe_artifact(record) for record in records],
    }


def browser_state(job: Job) -> str | None:
    if not job.payload.get("use_browser_tab"):
        return None
    return job.payload.get("browser_state", "waiting")


async def _conversation_images(conversation_id: UUID, owner_id: UUID) -> list[tuple[UUID, str, str]]:
    async with async_session_factory() as db:
        rows = await db.execute(
            select(Job.id, DocumentArtifactRecord.storage_name, DocumentArtifactRecord.original_name)
            .join(DocumentArtifactRecord, DocumentArtifactRecord.job_id == Job.id)
            .join(Message, Message.artifact_run_id == Job.id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Conversation.id == conversation_id, Conversation.owner_id == owner_id, Job.owner_id == owner_id,
                DocumentArtifactRecord.role == "output",
                DocumentArtifactRecord.content_type.in_(IMAGE_CONTENT_TYPES.values()),
            )
            .order_by(Message.created_at.desc(), DocumentArtifactRecord.original_name, DocumentArtifactRecord.storage_name)
            .limit(16)
        )
        return [(run_id, name, label or name) for run_id, name, label in rows]


async def finish_chat(db, job: Job, status: str, *, content: str | None = None,
                      error: str | None = None) -> None:
    """Caller holds the run row lock. Terminal state and transcript land together."""
    if job.status not in ACTIVE:
        return
    if content is None:
        content = (job.result or {}).get("content", "")
    job.result = {"content": content}
    job.status = status
    job.error = error
    job.payload = {key: value for key, value in job.payload.items()
                   if key not in ("browser_secret", "browser_observation")}
    db.add(Message(
        conversation_id=UUID(job.payload["conversation_id"]), role="assistant",
        content=content, model=WORKSPACE_MODEL, artifact_run_id=job.id,
    ))
    await db.commit()


async def _wait_for_browser(job_id: UUID) -> dict:
    try:
        async with asyncio.timeout(BROWSER_WAIT_TIMEOUT):
            while True:
                async with async_session_factory() as db:
                    job = await db.get(Job, job_id)
                    if job is None or job.status != "in_progress":
                        raise AgentIncomplete("Browser access was revoked. Mae stopped using that tab.")
                    if browser_state(job) == "received":
                        return job.payload["browser_observation"]
                await asyncio.sleep(0.5)
    except TimeoutError:
        raise AgentIncomplete("No browser data arrived. The helper may be offline or the grant was not used. Reconnect it and start a new run.") from None


async def _collect(job_id: UUID, payload: dict, state: dict) -> None:
    owner, key = await job_owner_and_key(job_id)
    conversation_id = UUID(payload["conversation_id"])
    async with async_session_factory() as db:
        user_message = await db.get(Message, UUID(payload["user_message_id"]))
        if user_message is None or user_message.conversation_id != conversation_id:
            raise ValueError("Chat message disappeared")
        rows = await db.scalars(select(Message).where(
            Message.conversation_id == conversation_id, Message.created_at <= user_message.created_at,
            Message.id != user_message.id, Message.role.in_(("user", "assistant")), Message.content != "",
        ).order_by(Message.created_at.desc(), Message.id.desc()).limit(59))
        messages = [{"role": "user", "content": user_message.content}]
        remaining = 120_000 - len(user_message.content)
        for message in rows:
            remaining -= len(message.content)
            if remaining < 0:
                break
            messages.append({"role": message.role, "content": message.content})
        messages.reverse()
    images = await _conversation_images(conversation_id, owner)
    extra = {}
    if payload.get("use_browser_tab"):
        state["progress"] = "Waiting for your browser helper…"
        extra["browser_observation"] = await _wait_for_browser(job_id)
        state["progress"] = "Browser data received. Working on your request…"
    async with aclosing(run_agent(messages, key, owner, job_id, conversation_images=images, **extra)) as events:
        async for event in events:
            if event["type"] == "token":
                state["content"] += event["text"]
            elif event["type"] == "progress":
                state["progress"] = event["message"]


async def _persist_progress(job_id: UUID, state: dict) -> bool:
    async with async_session_factory() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        if job is None or job.status != "in_progress":
            return False
        if job.result != state:
            job.result = dict(state)
            await db.commit()
        return True


async def chat_job(ctx: dict, job_id_str: str) -> None:
    job_id = UUID(job_id_str)
    async with async_session_factory() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        if job is None or job.type != CHAT_JOB or job.status != "queued":
            return
        job.status = "in_progress"
        payload = job.payload
        await db.commit()

    state = {"content": "", "progress": None}
    status, error = "done", None
    task = asyncio.create_task(_collect(job_id, payload, state))
    try:
        async with asyncio.timeout(RUN_TIMEOUT):
            while not task.done():
                await asyncio.wait({task}, timeout=0.5)
                if not task.done() and not await _persist_progress(job_id, state):
                    return
            await task
    except AgentIncomplete as exc:
        status, error = "incomplete", str(exc)
    except TimeoutError:
        status, error = "failed", "This run timed out. Any saved files are available in Artifacts."
    except Exception:
        status, error = "failed", "Mae couldn’t finish this run. Any saved files are available in Artifacts."
        logger.exception("Chat run %s failed", job_id)
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async with async_session_factory() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        if job is not None:
            await finish_chat(db, job, status, content=state["content"], error=error)


async def reconcile_chat_runs(ctx: dict) -> None:
    now = datetime.now(timezone.utc)
    stale = now - timedelta(seconds=RUN_TIMEOUT + 35)
    queue_expired = now - timedelta(minutes=10)
    async with async_session_factory() as db:
        queued = list(await db.scalars(select(Job.id).where(
            Job.type == CHAT_JOB, Job.status == "queued",
            Job.created_at >= queue_expired, Job.created_at < now - timedelta(seconds=2),
        ).order_by(Job.created_at).limit(100)))
        stranded = list(await db.scalars(select(Job.id).where(
            Job.type == CHAT_JOB,
            ((Job.status == "in_progress") & (Job.updated_at < stale))
            | ((Job.status == "queued") & (Job.created_at < queue_expired)),
        ).limit(100)))
    for run_id in stranded:
        async with async_session_factory() as db:
            job = await db.get(Job, run_id, with_for_update=True)
            if job is None:
                continue
            if job.status == "in_progress" and job.updated_at < stale:
                await finish_chat(db, job, "interrupted", error=INTERRUPTED)
            elif job.status == "queued" and job.created_at < queue_expired:
                await finish_chat(db, job, "failed", error="Mae couldn’t start this run. Try again.")
    for run_id in queued:
        await enqueue_chat(ctx["redis"], run_id)
