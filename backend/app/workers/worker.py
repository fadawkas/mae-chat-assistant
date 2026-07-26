from arq.connections import RedisSettings

from app.core.config import settings
from app.features.council.tasks import council_job
from app.features.research.tasks import research_job
from app.features.documents.tasks import document_job
from app.features.automation.tasks import automation_dispatcher
from arq import cron


class WorkerSettings:
    functions: list = [council_job, research_job, document_job]
    cron_jobs = [cron(automation_dispatcher, minute=set(range(60)))]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
