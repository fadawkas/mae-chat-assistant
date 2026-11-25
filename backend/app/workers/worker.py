from arq.connections import RedisSettings

from app.core.config import settings
from app.features.council.tasks import council_job
from app.features.research.tasks import research_job
from app.features.documents.tasks import document_job
from app.features.automation.routine import routine_job
from app.features.automation.tasks import automation_dispatcher
from app.services.chat_runs import chat_job, reconcile_chat_runs
from arq import cron


class WorkerSettings:
    functions: list = [council_job, research_job, document_job, routine_job, chat_job]
    cron_jobs = [
        cron(automation_dispatcher, minute=set(range(60))),
        cron(reconcile_chat_runs, second={0, 15, 30, 45}, run_at_startup=True),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
