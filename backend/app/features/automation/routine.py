"""Run a saved prompt using the same workspace capabilities as chat."""

import asyncio
import json
import logging
from contextlib import aclosing
from uuid import UUID

from app.core.database import async_session_factory
from app.models import Job
from app.schemas import RoutinePayload
from app.services.agent import run_agent
from app.services.completion import AgentIncomplete
from app.workers.context import job_owner_and_key
from app.workers.queue import PROGRESS_CHANNEL

logger = logging.getLogger(__name__)


async def routine_job(ctx: dict, job_id_str: str, payload: dict) -> None:
    job_id = UUID(job_id_str)
    channel = PROGRESS_CHANNEL.format(job_id_str)
    redis = ctx["redis"]
    async with async_session_factory() as db:
        job = await db.get(Job, job_id, with_for_update=True)
        # Do not repeat effects after a duplicate delivery.
        if job is None or job.status != "queued":
            return
        job.status = "in_progress"
        await db.commit()

    chunks: list[str] = []
    artifacts: list[dict] = []
    result = None
    error = None
    try:
        owner_id, api_key = await job_owner_and_key(job_id)
        options = RoutinePayload.model_validate({key: value for key, value in payload.items() if key != "automation_schedule_id"})
        await redis.publish(channel, json.dumps({"type": "status", "status": "in_progress", "message": "Running routine…"}))
        async with asyncio.timeout(175):
            async with aclosing(run_agent(
                [{"role": "user", "content": options.prompt}],
                api_key, owner_id, job_id, routine=True,
            )) as events:
                async for event in events:
                    if event["type"] == "token":
                        chunks.append(event["text"])
                    elif event["type"] == "artifact":
                        artifacts.append(event["artifact"])
                    elif event["type"] == "progress":
                        await redis.publish(channel, json.dumps(event))
        result = {"content": "".join(chunks), "artifacts": artifacts}
    except AgentIncomplete as exc:
        error = str(exc)
        result = {"content": "".join(chunks), "artifacts": artifacts}
    except TimeoutError:
        error = "The routine timed out. Any saved files are available in Artifacts."
    except Exception:
        error = "The routine couldn’t finish. Check your OpenRouter key and try again."
        logger.exception("Routine %s failed", job_id)

    async with async_session_factory() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        job.status = "failed" if error else "done"
        job.result = result
        job.error = error
        await db.commit()
    await redis.publish(channel, json.dumps(
        {"type": "error", "status": "failed", "message": error} if error
        else {"type": "done", "status": "done", "result": result}
    ))
