import uuid
from datetime import datetime

from app.core.database import async_session_factory
from app.models import AutomationSchedule, Job
from app.workers.queue import get_arq_redis

TASKS = {"agent": "routine_job", "research": "research_job", "council": "council_job", "document": "document_job"}


class ScheduleDispatchError(RuntimeError):
    pass


async def dispatch_schedule(schedule_id: uuid.UUID, run_at: datetime) -> uuid.UUID:
    async with async_session_factory() as db:
        schedule = await db.get(AutomationSchedule, schedule_id, with_for_update=True)
        if schedule is None:
            raise ScheduleDispatchError("Routine not found")
        task = TASKS[schedule.task_type]
        job_id = uuid.uuid4()
        payload = dict(schedule.payload or {})
        payload["automation_schedule_id"] = str(schedule.id)
        db.add(Job(id=job_id, owner_id=schedule.owner_id, type=schedule.task_type, status="queued", title=schedule.name, payload=payload))
        schedule.last_run_at = run_at
        schedule.last_job_id = job_id
        # The worker can start immediately once the job is queued.
        await db.commit()

    try:
        redis = await get_arq_redis()
        try:
            await redis.enqueue_job(task, str(job_id), payload)
        finally:
            await redis.aclose()
    except Exception as exc:
        async with async_session_factory() as db:
            job = await db.get(Job, job_id, with_for_update=True)
            if job is not None and job.status == "queued":
                job.status = "failed"
                job.error = "Could not queue the routine"
                await db.commit()
        raise ScheduleDispatchError("Could not queue the routine") from exc
    return job_id
