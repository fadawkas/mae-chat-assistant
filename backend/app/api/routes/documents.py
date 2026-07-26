import uuid
from pathlib import Path
from sqlalchemy import select

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends

from app.core.config import settings
from app.core.database import async_session_factory
from app.models import Job
from app.schemas import DocumentFormat, DocumentMode, JobEnqueueResponse
from app.workers.queue import get_arq_redis
from app.core.auth import current_user, require_csrf
from app.models import User

router = APIRouter()
FORMATS = {item.value for item in DocumentFormat}
MAX_PROMPT_LENGTH = 20_000

@router.post("/api/documents", response_model=JobEnqueueResponse, dependencies=[Depends(require_csrf)])
async def enqueue_document(format: str = Form(...), prompt: str = Form(""), mode: str = Form("create"), title: str | None = Form(None), model: str | None = Form(None), page_start: int | None = Form(None), page_end: int | None = Form(None), file: UploadFile | None = File(None), files: list[UploadFile] | None = File(None), user: User = Depends(current_user)):
    files = files or ([] if file is None else [file])
    if format not in FORMATS or mode not in {item.value for item in DocumentMode} or (mode not in {"pdf_merge", "pdf_split"} and (not prompt.strip() or len(prompt) > MAX_PROMPT_LENGTH)):
        raise HTTPException(400, "Invalid document request")
    if mode in {"edit", "pdf_rebuild", "pdf_split"} and not files:
        raise HTTPException(400, "An input file is required for editing")
    if mode == "pdf_merge" and len(files) < 2:
        raise HTTPException(400, "PDF merge requires at least two files")
    if mode == "pdf_split" and (page_start is None or page_end is None):
        raise HTTPException(400, "PDF split requires page_start and page_end")
    if format != "pdf" and len(files) > 1:
        raise HTTPException(400, "Multiple input files are supported only for PDF merge")
    if any(Path(item.filename or "").suffix.lower().lstrip(".") != format for item in files):
        raise HTTPException(400, "Input file format must match output format")
    job_id = uuid.uuid4()
    upload_names = []
    if files:
        upload_root = Path(settings.upload_dir) / str(user.id) / str(job_id)
        upload_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        for item in files:
            upload_name = f"{uuid.uuid4()}.{format}"
            target = upload_root / upload_name
            size = 0
            with target.open("wb") as out:
                while chunk := await item.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload_bytes:
                        target.unlink(missing_ok=True)
                        raise HTTPException(413, "Uploaded file is too large")
                    out.write(chunk)
            upload_names.append(upload_name)
    payload = {"format": format, "mode": mode, "prompt": prompt, "title": title, "model": model, "upload_filenames": upload_names, "page_start": page_start, "page_end": page_end}
    async with async_session_factory() as db:
        db.add(Job(id=job_id, owner_id=user.id, type="document", status="queued", title=title or prompt[:80], payload=payload))
        await db.commit()
    try:
        redis = await get_arq_redis()
        await redis.enqueue_job("document_job", str(job_id), payload)
        await redis.aclose()
    except Exception:
        async with async_session_factory() as db:
            job = await db.get(Job, job_id)
            job.status = "failed"; job.error = "Unable to enqueue document job"
            await db.commit()
        for upload_name in upload_names: (Path(settings.upload_dir) / str(user.id) / str(job_id) / upload_name).unlink(missing_ok=True)
        raise HTTPException(503, "Unable to enqueue document job")
    return JobEnqueueResponse(job_id=job_id)
