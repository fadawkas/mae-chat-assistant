import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import select

from app.core.database import async_session_factory
from app.models import AutomationSchedule
from app.workers.automation import dispatch_schedule

logger = logging.getLogger("mae.automation")

async def automation_dispatcher(ctx: dict) -> None:
    now = datetime.now(timezone.utc)
    async with async_session_factory() as db:
        schedules = (await db.execute(select(AutomationSchedule).where(AutomationSchedule.enabled.is_(True)))).scalars().all()
        due = []
        for schedule in schedules:
            try:
                local_zone = ZoneInfo(schedule.timezone)
                base = (schedule.last_run_at or schedule.created_at).astimezone(local_zone)
                if croniter(schedule.cron_expression, base).get_next(datetime) <= now:
                    due.append(schedule)
            except (ValueError, KeyError):
                logger.warning("Ignoring invalid automation schedule %s", schedule.id)
        for schedule in due:
            await dispatch_schedule(schedule.id, now)
