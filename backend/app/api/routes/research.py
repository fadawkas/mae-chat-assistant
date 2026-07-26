import uuid

from fastapi import APIRouter, Depends

from app.core.database import async_session_factory
from app.core.auth import current_user, require_csrf
from app.models import Job, User
from app.workers.queue import get_arq_redis
from app.schemas import JobEnqueueResponse, ResearchRequest

router = APIRouter()


@router.post("/api/research", response_model=JobEnqueueResponse, dependencies=[Depends(require_csrf)])
async def enqueue_research(body: ResearchRequest, user: User = Depends(current_user)):
    """Enqueue a research job and return its ID."""
    job_id = uuid.uuid4()

    payload = {
        "query": body.query,
        "model": body.model,
    }

    # Insert queued row
    async with async_session_factory() as db:
        db.add(Job(
            id=job_id,
            owner_id=user.id,
            type="research",
            status="queued",
            payload=payload,
        ))
        await db.commit()

    # Enqueue on ARQ
    arq_redis = await get_arq_redis()
    await arq_redis.enqueue_job("research_job", str(job_id), payload)
    await arq_redis.aclose()

    return JobEnqueueResponse(job_id=job_id)
