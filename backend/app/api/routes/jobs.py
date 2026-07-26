import asyncio
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.auth import current_user, require_csrf
from app.models import Job, User, DocumentArtifactRecord
from app.workers.queue import get_arq_redis, subscribe_progress
from app.schemas import JobEnqueueResponse, JobStatusResponse
from app.core.config import settings

router = APIRouter()

PROGRESS_EVENT_TYPES = frozenset({"status", "progress", "code", "done", "error", "failed"})


@router.get("/api/jobs", response_model=list[JobStatusResponse])
async def list_jobs(type: str | None = None, council_id: str | None = None, limit: int = 20, user: User = Depends(current_user)):
    """List recent jobs, optionally filtered by type and/or council_id."""
    async with async_session_factory() as db:
        stmt = select(Job).where(Job.owner_id == user.id).order_by(Job.created_at.desc()).limit(limit)
        if type:
            stmt = stmt.where(Job.type == type)
        if council_id:
            stmt = stmt.where(Job.council_id == uuid.UUID(council_id))
        result = await db.execute(stmt)
        jobs = result.scalars().all()
        return [
            JobStatusResponse(
                id=j.id,
                type=j.type,
                status=j.status,
                title=j.title,
                council_id=j.council_id,
                payload=j.payload,
                result=j.result,
                error=j.error,
                created_at=j.created_at,
                updated_at=j.updated_at,
            )
            for j in jobs
        ]


def _sse_event(data: dict) -> str:
    """Build an SSE data frame from a dict."""
    return f"data: {json.dumps(data)}\n\n"


@router.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: uuid.UUID, user: User = Depends(current_user)):
    """Poll the current status and result of a job."""
    async with async_session_factory() as db:
        result = await db.execute(select(Job).where(Job.id == job_id, Job.owner_id == user.id))
        job = result.scalar_one_or_none()

    if job is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        id=job.id,
        type=job.type,
        status=job.status,
        title=job.title,
        council_id=job.council_id,
        payload=job.payload,
        result=job.result,
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


@router.delete("/api/jobs/{job_id}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_job(job_id: uuid.UUID, user: User = Depends(current_user)):
    """Delete a job record."""
    async with async_session_factory() as db:
        result = await db.execute(select(Job).where(Job.id == job_id, Job.owner_id == user.id))
        job = result.scalar_one_or_none()
        if job is None:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Job not found")
        if job.type == "document":
            uploads = (job.payload or {}).get("upload_filenames", [])
            if not uploads and (job.payload or {}).get("upload_filename"):
                uploads = [(job.payload or {}).get("upload_filename")]
            artifact = (job.result or {}).get("artifact", {})
            preview = (job.result or {}).get("render", {}).get("preview_url", "").split("/api/files/")[-1]
            for directory, name in [(settings.upload_dir, upload) for upload in uploads] + [(settings.output_dir, artifact.get("filename")), (settings.output_dir, preview)]:
                if name:
                    path = (Path(directory) / name).resolve()
                    if path.parent == Path(directory).resolve() and path.is_file(): path.unlink()
        await db.delete(job)
        await db.commit()


@router.get("/api/files/{filename}")
async def download_file(filename: str, download_name: str | None = None, user: User = Depends(current_user)):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    async with async_session_factory() as db:
        artifact = (await db.execute(select(DocumentArtifactRecord).join(Job, Job.id == DocumentArtifactRecord.job_id).where(DocumentArtifactRecord.storage_name == filename, Job.owner_id == user.id))).scalar_one_or_none()
        if artifact is None:
            raise HTTPException(404, "File not found")
        job = await db.get(Job, artifact.job_id)
    path = (Path(settings.output_dir) / str(user.id) / str(job.id) / filename).resolve()
    if Path(filename).name != filename or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=Path(download_name).name if download_name else filename)


@router.get("/api/jobs/{job_id}/stream")
async def stream_job_progress(job_id: uuid.UUID, user: User = Depends(current_user)):
    """
    SSE endpoint that streams job progress events.

    1. Checks the DB for current status.
       - If ``done`` / ``failed``: emit one event and close.
       - Otherwise: subscribe to Redis pub/sub and stream live events.
    2. Cleans up the pub/sub connection on client disconnect via the
       ``finally`` block in ``subscribe_progress``.
    """
    # Check current status first
    async with async_session_factory() as db:
        result = await db.execute(select(Job).where(Job.id == job_id, Job.owner_id == user.id))
        job = result.scalar_one_or_none()

    async def _stream():
        if job is None:
            yield _sse_event({"type": "error", "message": "Job not found"})
            return

        # If already terminal, emit once and close
        if job.status == "done":
            yield _sse_event({"type": "done", "result": job.result, "status": "done"})
            return
        if job.status == "failed":
            yield _sse_event({"type": "error", "message": job.error, "status": "failed"})
            return

        yield _sse_event({"type": "status", "status": job.status, "message": "Queued" if job.status == "queued" else "In progress"})

        # Keep the proxy connection alive while a model is generating code.
        events = subscribe_progress(str(job_id))
        next_event = asyncio.create_task(anext(events))
        try:
            while True:
                done, _ = await asyncio.wait({next_event}, timeout=15)
                if not done:
                    yield ": keepalive\n\n"
                    continue
                event = next_event.result()
                next_event = asyncio.create_task(anext(events))
                if event.get("type") not in PROGRESS_EVENT_TYPES:
                    continue
                yield _sse_event(event)
                if event.get("type") in ("done", "error", "failed"):
                    return
        finally:
            next_event.cancel()
            await asyncio.gather(next_event, return_exceptions=True)
            await events.aclose()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
