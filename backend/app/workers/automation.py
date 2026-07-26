import uuid
from datetime import datetime

from app.core.database import async_session_factory
from app.models import AutomationSchedule, Job
from app.workers.queue import get_arq_redis

TASKS = {"research": "research_job", "council": "council_job", "document": "document_job"}

async def dispatch_schedule(schedule_id: uuid.UUID, run_at: datetime) -> uuid.UUID:
    async with async_session_factory() as db:
        schedule = await db.get(AutomationSchedule, schedule_id)
        if schedule is None:
            raise ValueError("Automation schedule not found")
        job_id = uuid.uuid4()
        payload = dict(schedule.payload or {})
        payload["automation_schedule_id"] = str(schedule.id)
        db.add(Job(id=job_id, owner_id=schedule.owner_id, type=schedule.task_type, status="queued", title=schedule.name, payload=payload))
        redis = await get_arq_redis()
        try:
            await redis.enqueue_job(TASKS[schedule.task_type], str(job_id), payload)
        finally:
            await redis.aclose()
        schedule.last_run_at = run_at
        schedule.last_job_id = job_id
        await db.commit()
        return job_id
