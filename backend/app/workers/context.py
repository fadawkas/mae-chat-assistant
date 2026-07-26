"""Worker-only resolution of secrets and tenant paths.

Job payloads are deliberately not used for either value: they are persisted
and transported through Redis.
"""
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from app.core.auth import decrypt_key
from app.core.database import async_session_factory
from app.models import Job


async def job_owner_and_key(job_id: UUID) -> tuple[UUID, str]:
    async with async_session_factory() as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
        from app.models import User
        user = (await db.execute(select(User).where(User.id == job.owner_id))).scalar_one()
        if not user.openrouter_key_encrypted:
            raise ValueError("Owner has no configured OpenRouter API key")
        return user.id, decrypt_key(user.openrouter_key_encrypted)


def tenant_dir(root: str, owner_id: UUID) -> Path:
    path = (Path(root) / str(owner_id)).resolve()
    base = Path(root).resolve()
    if path.parent != base:
        raise ValueError("Invalid tenant storage root")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
