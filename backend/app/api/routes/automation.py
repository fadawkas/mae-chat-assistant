import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.auth import current_user, require_csrf
from app.models import AutomationSchedule, Job, User
from app.schemas import AutomationScheduleCreate, AutomationScheduleOut, AutomationScheduleUpdate, JobEnqueueResponse
from app.workers.automation import dispatch_schedule

router = APIRouter()
TASK_TYPES = {"research", "council", "document"}

def out(item: AutomationSchedule) -> AutomationScheduleOut:
    return AutomationScheduleOut(
        id=item.id, name=item.name, description=item.description, task_type=item.task_type,
        cron_expression=item.cron_expression, timezone=item.timezone, enabled=item.enabled,
        payload=item.payload, last_run_at=item.last_run_at, last_job_id=item.last_job_id,
        created_at=item.created_at, updated_at=item.updated_at,
    )

def validate_payload(task_type: str, payload: dict) -> None:
    if task_type not in TASK_TYPES:
        raise HTTPException(400, "task_type must be research, council, or document")
    required = {"research": "query", "council": "prompt", "document": "prompt"}[task_type]
    if not str(payload.get(required, "")).strip():
        raise HTTPException(400, f"{task_type} automation requires {required}")
    if task_type == "document" and payload.get("mode", "create") != "create":
        raise HTTPException(400, "Scheduled documents support create mode only")

@router.get("/api/automation/schedules", response_model=list[AutomationScheduleOut])
async def list_schedules(user: User = Depends(current_user)):
    async with async_session_factory() as db:
        rows = (await db.execute(select(AutomationSchedule).where(AutomationSchedule.owner_id == user.id).order_by(AutomationSchedule.created_at.desc()))).scalars().all()
        return [out(row) for row in rows]

@router.post("/api/automation/schedules", response_model=AutomationScheduleOut, dependencies=[Depends(require_csrf)])
async def create_schedule(body: AutomationScheduleCreate, user: User = Depends(current_user)):
    validate_payload(body.task_type, body.payload)
    schedule = AutomationSchedule(owner_id=user.id, **body.model_dump())
    async with async_session_factory() as db:
        db.add(schedule)
        await db.commit()
        await db.refresh(schedule)
        return out(schedule)

@router.put("/api/automation/schedules/{schedule_id}", response_model=AutomationScheduleOut, dependencies=[Depends(require_csrf)])
async def update_schedule(schedule_id: uuid.UUID, body: AutomationScheduleUpdate, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        schedule = (await db.execute(select(AutomationSchedule).where(AutomationSchedule.id == schedule_id, AutomationSchedule.owner_id == user.id))).scalar_one_or_none()
        if schedule is None:
            raise HTTPException(404, "Automation schedule not found")
        changes = body.model_dump(exclude_unset=True)
        validate_payload(schedule.task_type, changes.get("payload", schedule.payload))
        for key, value in changes.items():
            setattr(schedule, key, value)
        await db.commit()
        await db.refresh(schedule)
        return out(schedule)

@router.delete("/api/automation/schedules/{schedule_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        schedule = (await db.execute(select(AutomationSchedule).where(AutomationSchedule.id == schedule_id, AutomationSchedule.owner_id == user.id))).scalar_one_or_none()
        if schedule is None:
            raise HTTPException(404, "Automation schedule not found")
        await db.delete(schedule)
        await db.commit()

@router.post("/api/automation/schedules/{schedule_id}/run", response_model=JobEnqueueResponse, dependencies=[Depends(require_csrf)])
async def run_schedule(schedule_id: uuid.UUID, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        schedule = (await db.execute(select(AutomationSchedule).where(AutomationSchedule.id == schedule_id, AutomationSchedule.owner_id == user.id))).scalar_one_or_none()
        if schedule is None:
            raise HTTPException(404, "Automation schedule not found")
    return JobEnqueueResponse(job_id=await dispatch_schedule(schedule_id, datetime.now(timezone.utc)))

@router.get("/api/automation/jobs", response_model=list[dict])
async def automation_jobs(limit: int = 50, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        rows = (await db.execute(select(Job).where(Job.owner_id == user.id, Job.payload["automation_schedule_id"].as_string().is_not(None)).order_by(Job.created_at.desc()).limit(min(limit, 100)))).scalars().all()
        return [{"id": row.id, "type": row.type, "status": row.status, "title": row.title, "result": row.result, "error": row.error, "created_at": row.created_at} for row in rows]
