import asyncio
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select

from app.core.database import async_session_factory
from app.core.auth import current_user, require_csrf
from app.models import Job, User, DocumentArtifactRecord
from app.workers.queue import get_arq_redis, subscribe_progress
from app.schemas import ArtifactOut, JobStatusResponse
from app.core.config import settings
from app.services.artifacts import IMAGE_CONTENT_TYPES, artifact_download_name, artifact_path, describe_artifact

router = APIRouter()
logger = logging.getLogger(__name__)

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
    """Delete a job record and its saved output files."""
    async with async_session_factory() as db:
        job = await db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == user.id).with_for_update())
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.type == "chat":
            raise HTTPException(409, "Chat runs are managed through their conversation")
        names = (await db.scalars(select(DocumentArtifactRecord.storage_name).where(
            DocumentArtifactRecord.job_id == job_id, DocumentArtifactRecord.role.in_(("output", "preview")),
        ))).all()
        legacy = job.type == "document"
        uploads = (job.payload or {}).get("upload_filenames", [])
        if not uploads and (job.payload or {}).get("upload_filename"):
            uploads = [job.payload["upload_filename"]]
        await db.delete(job)
        await db.commit()

    for name in names:
        for flat in (False, True) if legacy else (False,):
            try:
                artifact_path(user.id, job_id, name, legacy=flat).unlink(missing_ok=True)
            except ValueError:
                continue
    if legacy:
        root = Path(settings.upload_dir).resolve() / str(user.id) / str(job_id)
        for name in uploads:
            path = root / name
            if path.parent == root and path.resolve() == path:
                path.unlink(missing_ok=True)


@router.get("/api/artifacts", response_model=list[ArtifactOut])
async def list_artifacts(
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
    user: User = Depends(current_user),
):
    async with async_session_factory() as db:
        artifacts = await db.scalars(
            select(DocumentArtifactRecord).join(Job)
            .where(Job.owner_id == user.id, DocumentArtifactRecord.role == "output")
            .order_by(DocumentArtifactRecord.created_at.desc(), DocumentArtifactRecord.id.desc())
            .offset(offset).limit(limit)
        )
        return [{**describe_artifact(record), "created_at": record.created_at} for record in artifacts]


@router.delete("/api/artifacts/{filename}", status_code=204, dependencies=[Depends(require_csrf)])
async def delete_artifact(filename: str, user: User = Depends(current_user)):
    """Delete a saved artifact without removing the job that created it."""
    async with async_session_factory() as db:
        row = (await db.execute(
            select(DocumentArtifactRecord, Job.type).join(Job)
            .where(
                DocumentArtifactRecord.storage_name == filename, Job.owner_id == user.id,
                DocumentArtifactRecord.role == "output",
            ).with_for_update(of=DocumentArtifactRecord)
        )).one_or_none()
        if row is None:
            raise HTTPException(404, "Artifact not found")

        artifact, job_type = row
        records = [artifact]
        legacy = job_type == "document"
        if legacy:
            records.extend(await db.scalars(select(DocumentArtifactRecord).where(
                DocumentArtifactRecord.job_id == artifact.job_id,
                DocumentArtifactRecord.role == "preview",
                DocumentArtifactRecord.storage_name == f"{filename}.png",
            )))

        paths = []
        for record in records:
            for flat in (False, True) if legacy else (False,):
                try:
                    paths.append(artifact_path(user.id, record.job_id, record.storage_name, legacy=flat))
                except ValueError:
                    logger.warning("Skipping invalid storage path for artifact %s", record.id)
            await db.delete(record)
        await db.commit()

    # Revoke access before removing files so a failed database commit cannot lose data.
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove stored artifact file %s", path)


@router.get("/api/files/{filename}")
async def download_file(filename: str, download_name: str | None = None, inline: bool = False, user: User = Depends(current_user)):
    async with async_session_factory() as db:
        row = (await db.execute(
            select(DocumentArtifactRecord, Job.type).join(Job)
            .where(
                DocumentArtifactRecord.storage_name == filename, Job.owner_id == user.id,
                DocumentArtifactRecord.role.in_(("output", "preview")),
            )
        )).one_or_none()
    if row is None:
        raise HTTPException(404, "File not found")
    artifact, job_type = row
    try:
        path = artifact_path(user.id, artifact.job_id, filename)
        if job_type == "document" and not path.is_file():
            path = artifact_path(user.id, artifact.job_id, filename, legacy=True)
    except ValueError:
        raise HTTPException(404, "File not found") from None
    if not path.is_file():
        raise HTTPException(404, "File not found")
    name = Path(download_name).name if download_name else artifact_download_name(artifact)
    can_preview = artifact.role == "output" and artifact.content_type in {"application/pdf", *IMAGE_CONTENT_TYPES.values()}
    return FileResponse(
        path, filename=name, media_type=artifact.content_type or "application/octet-stream",
        content_disposition_type="inline" if inline and can_preview else "attachment",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


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
