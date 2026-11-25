import json
import shutil
import uuid
import logging
import hashlib
from pathlib import Path

import httpx
import redis.asyncio as aioredis
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from pypdf import PdfReader
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.features.documents.agent import generate_code
from app.features.documents.validation import validate
from app.features.documents.pdf_ops import merge_pdfs, split_pdf
from app.services.artifacts import CONTENT_TYPES, artifact_title, describe_artifact
from app.models import DocumentArtifactRecord, Job
from app.workers.queue import PROGRESS_CHANNEL
from app.workers.context import job_owner_and_key, tenant_dir

logger = logging.getLogger("mae.documents")

def extract_text(path: Path, fmt: str) -> str:
    if fmt == "docx": return "\n".join(p.text for p in Document(path).paragraphs)[:30000]
    if fmt == "pptx": return "\n".join(s.text for sl in Presentation(path).slides for s in sl.shapes if hasattr(s, "text"))[:30000]
    if fmt == "xlsx":
        wb = load_workbook(path, read_only=True, data_only=False)
        return "\n".join(f"{ws.title}: " + " | ".join(str(v) for row in ws.iter_rows(values_only=True) for v in row if v is not None) for ws in wb.worksheets)[:30000]
    return "\n".join(p.extract_text() or "" for p in PdfReader(path).pages)[:30000]


def artifact_preview(path: Path, fmt: str) -> dict[str, str]:
    text = extract_text(path, fmt)
    if fmt == "pptx":
        summary = f"{len(Presentation(path).slides)} slides"
    elif fmt == "docx":
        summary = f"{len(Document(path).paragraphs)} paragraphs"
    elif fmt == "xlsx":
        workbook = load_workbook(path, read_only=True)
        summary = f"{len(workbook.sheetnames)} sheets"
        workbook.close()
    else:
        summary = f"{len(PdfReader(path).pages)} pages"
    return {"summary": summary, "text": text[:1600]}


async def document_job(ctx: dict, job_id_str: str, payload: dict) -> dict:
    job_id = uuid.UUID(job_id_str)
    owner_id, api_key = await job_owner_and_key(job_id)
    redis = ctx.get("redis")
    if not hasattr(redis, "publish"): redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    workspace_name = f"{owner_id}-{job_id}"
    workspace = Path("/workspaces") / workspace_name
    source_names = payload.get("upload_filenames", [])
    if not source_names and payload.get("upload_filename"):
        source_names = [payload["upload_filename"]]
    upload_root = tenant_dir(settings.upload_dir, owner_id)
    output_root = tenant_dir(settings.output_dir, owner_id)
    sources = [upload_root / name for name in source_names]
    source = sources[0] if sources else None
    try:
        async with async_session_factory() as db:
            job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
            job.status = "in_progress"
            await db.commit()
        await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"status","status":"in_progress","message":"Thinking..."}))
        async with httpx.AsyncClient(timeout=15) as client:
            provision = await client.post(
                f"{settings.sandbox_url}/workspaces",
                json={"workspace": workspace_name},
            )
            provision.raise_for_status()
        workspace.mkdir(parents=True, exist_ok=True)
        source_text = extract_text(source, payload["format"]) if source else ""
        artifact_path = workspace / f"output.{payload['format']}"
        extension = payload["format"]
        title = explicit_title = artifact_title(payload.get("title") or "", extension)
        last_error = None
        validation: list[str] = []
        if payload.get("mode") == "pdf_merge":
            await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"progress","phase":"editing","message":"Merging PDF files...","status":"in_progress"}))
            merge_pdfs(sources, artifact_path)
            validation = validate(artifact_path, "pdf", payload.get("prompt", ""))
        elif payload.get("mode") == "pdf_split":
            await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"progress","phase":"editing","message":"Splitting PDF pages...","status":"in_progress"}))
            split_pdf(source, artifact_path, int(payload["page_start"]), int(payload["page_end"]))
            validation = validate(artifact_path, "pdf", payload.get("prompt", ""))
        else:
            for attempt in range(1, settings.document_max_attempts + 1):
                if attempt > 1:
                    await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"retrying","attempt":attempt,"max_attempts":settings.document_max_attempts,"message":f"Retrying document generation ({attempt}/{settings.document_max_attempts})...","status":"in_progress"}))
                await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"progress","phase":"thinking","message":"Thinking...","status":"in_progress"}))
                async def publish_code(chunk: str) -> None:
                    await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"code","chunk":chunk,"status":"in_progress"}))
                try:
                    code, suggested_title = await generate_code(extension, explicit_title, payload["prompt"], source_text, payload.get("model"), publish_code, last_error, payload.get("mode", "create"), api_key)
                    request = {"workspace": workspace_name, "code": code, "output": f"output.{payload['format']}", "timeout": settings.sandbox_timeout_seconds}
                    await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"progress","phase":"executing","message":"Running the document generator..."}))
                    async with httpx.AsyncClient(timeout=settings.sandbox_timeout_seconds + 10) as client:
                        response = await client.post(f"{settings.sandbox_url}/run", json=request)
                        if not response.is_success:
                            try: last_error = str(response.json().get("detail", response.text))
                            except ValueError: last_error = response.text
                            response.raise_for_status()
                    await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"progress","phase":"validating","message":"Validating the generated file..."}))
                    validation = validate(artifact_path, payload["format"], payload["prompt"])
                    title = explicit_title or artifact_title(suggested_title or "", extension)
                    break
                except Exception as exc:
                    last_error = str(exc)[:500] or "Generated document was invalid"
                    logger.exception("Document job %s attempt %s failed", job_id_str, attempt)
                    (workspace / f"output.{payload['format']}").unlink(missing_ok=True)
                    if attempt == settings.document_max_attempts: raise ValueError(last_error) from exc
        output = output_root
        filename = f"{uuid.uuid4()}.{payload['format']}"; final_path = output / filename
        shutil.copyfile(artifact_path, final_path)
        render_checks: list[str] = []
        render_data: dict = {}
        async with httpx.AsyncClient(timeout=110) as client:
            render_response = await client.post(
                f"{settings.renderer_url}/render",
                json={"tenant": str(owner_id), "filename": filename, "format": payload["format"]},
            )
            render_response.raise_for_status()
            render_data = render_response.json()
            render_checks.append(f"rendered to PDF ({render_data['pages']} pages)")
            rendered_preview = output / f"{filename}.png"
            preview_source = output / ".renders" / render_data["preview"]
            shutil.copyfile(preview_source, rendered_preview)
            render_data["preview_url"] = f"/api/files/{rendered_preview.name}"
        title = title or artifact_title(payload["prompt"], extension) or "Document"
        display_name = f"{title}.{extension}"
        content_type = CONTENT_TYPES[extension]
        record = DocumentArtifactRecord(
            job_id=job_id, role="output", storage_name=filename, original_name=display_name,
            content_type=content_type, format=extension, size=final_path.stat().st_size,
            sha256=hashlib.sha256(final_path.read_bytes()).hexdigest(),
        )
        artifact = describe_artifact(record)
        result_payload = {"format":payload["format"],"mode":payload["mode"],"prompt":payload["prompt"],"artifact":artifact,"preview":artifact_preview(final_path, payload["format"]),"render":render_data,"validation":{"format":payload["format"],"checks":validation + render_checks}}
        async with async_session_factory() as db:
            job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
            job.status = "done"; job.result = result_payload; job.title = title
            db.add(record)
            db.add(DocumentArtifactRecord(job_id=job_id, role="preview", storage_name=rendered_preview.name, original_name=f"{display_name}.png", content_type="image/png", format=payload["format"], size=rendered_preview.stat().st_size, sha256=hashlib.sha256(rendered_preview.read_bytes()).hexdigest()))
            for source_path in sources:
                if source_path.is_file():
                    db.add(DocumentArtifactRecord(job_id=job_id, role="input", storage_name=source_path.name, original_name=source_path.name, content_type=content_type, format=extension, size=source_path.stat().st_size, sha256=hashlib.sha256(source_path.read_bytes()).hexdigest()))
            await db.commit()
        await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"done","result":result_payload,"status":"done"}))
        return result_payload
    except Exception as exc:
        logger.exception("Document job %s failed after retries", job_id_str)
        async with async_session_factory() as db:
            job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one(); job.status = "failed"; job.error = str(exc)[:500] or "Document generation failed"; await db.commit()
        await redis.publish(PROGRESS_CHANNEL.format(job_id_str), json.dumps({"type":"error","message":str(exc)[:500] or "Document generation failed","status":"failed"})); raise
    finally:
        for source_path in sources: source_path.unlink(missing_ok=True)
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await client.delete(f"{settings.sandbox_url}/workspaces/{workspace_name}")
        except Exception:
            logger.exception("Unable to clean sandbox workspace %s", workspace_name)
        shutil.rmtree(workspace, ignore_errors=True)
        if redis is not ctx.get("redis"): await redis.aclose()
