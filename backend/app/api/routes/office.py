"""Optional ONLYOFFICE integration. Internal document requests use signed, expiring tickets."""

import base64
import hashlib
import hmac
import io
import json
import logging
import time
from pathlib import Path
from uuid import UUID, uuid4
from zipfile import BadZipFile, ZipFile

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.auth import current_user, require_csrf
from app.core.config import settings
from app.core.database import async_session_factory
from app.models import DocumentArtifactRecord, Job, User
from app.services.artifacts import CONTENT_TYPES, artifact_path

router = APIRouter()
logger = logging.getLogger(__name__)
FORMATS = {"docx": ("word", "word/document.xml"), "xlsx": ("cell", "xl/workbook.xml"), "pptx": ("slide", "ppt/presentation.xml")}
MAX_BYTES = 20 * 1024 * 1024


class RedactOfficeTickets(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Uvicorn's access-log arguments include the complete request path.
        args = record.args
        if isinstance(args, tuple) and len(args) == 5 and str(args[2]).startswith("/office-internal/"):
            record.args = (*args[:2], "/office-internal/[redacted]", *args[3:])
        return True


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _signature(value: str, secret: str) -> str:
    return _encode(hmac.digest(secret.encode(), value.encode(), "sha256"))


def _token(payload: dict, secret: str) -> str:
    value = _encode(b'{"alg":"HS256","typ":"JWT"}') + "." + _encode(json.dumps(payload).encode())
    return value + "." + _signature(value, secret)


def _claims(token: str, secret: str) -> dict:
    try:
        header, body, signature = token.split(".")
        if not hmac.compare_digest(_signature(f"{header}.{body}", secret), signature):
            raise ValueError
        if json.loads(_decode(header)).get("alg") != "HS256":
            raise ValueError
        claims = json.loads(_decode(body))
        if not isinstance(claims, dict) or ("exp" in claims and claims["exp"] <= time.time()):
            raise ValueError
        return claims
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(403, "Invalid editor credentials") from None


def _require_editor():
    if len(settings.office_jwt_secret) < 32 or not settings.office_public_url:
        raise HTTPException(503, "The Office editor is not enabled on this server")


async def _source(owner: UUID, filename: str):
    async with async_session_factory() as db:
        row = (await db.execute(select(DocumentArtifactRecord, Job.type).join(Job).where(
            Job.owner_id == owner, DocumentArtifactRecord.storage_name == filename,
            DocumentArtifactRecord.role == "output",
        ))).one_or_none()
    if row is None:
        raise HTTPException(404, "Artifact not found")
    artifact, job_type = row
    if artifact.format not in FORMATS:
        raise HTTPException(415, "This file format is not editable")
    try:
        path = artifact_path(owner, artifact.job_id, filename)
        if job_type == "document" and not path.is_file():
            path = artifact_path(owner, artifact.job_id, filename, legacy=True)
    except ValueError:
        raise HTTPException(404, "Artifact not found") from None
    if not path.is_file():
        raise HTTPException(404, "Artifact not found")
    if path.stat().st_size > MAX_BYTES:
        raise HTTPException(413, "This artifact exceeds the 20 MB editor limit")
    return artifact, path


@router.post("/api/artifacts/{filename}/editor", dependencies=[Depends(require_csrf)])
async def open_editor(filename: str, user: User = Depends(current_user)):
    _require_editor()
    artifact, _ = await _source(user.id, filename)
    key = uuid4().hex
    ticket = _token({"owner": str(user.id), "file": filename, "key": key, "exp": int(time.time()) + 86400}, "ticket:" + settings.office_jwt_secret)
    internal = f"{settings.office_mae_url.rstrip('/')}/office-internal"
    config = {
        "documentType": FORMATS[artifact.format][0], "width": "100%", "height": "100%",
        "document": {
            "fileType": artifact.format, "key": key, "title": artifact.original_name or filename,
            "url": f"{internal}/source/{ticket}",
            "permissions": {"edit": True, "print": True, "download": True},
        },
        "editorConfig": {
            "mode": "edit", "callbackUrl": f"{internal}/callback/{ticket}",
            "customization": {"plugins": False, "macros": False},
            "user": {"id": str(user.id), "name": f"{user.first_name} {user.last_name}"},
        },
    }
    return {"copy_id": str(UUID(hex=key)), "script_url": settings.office_public_url.rstrip('/') + '/web-apps/apps/api/documents/api.js',
            "config": {**config, "token": _token(config, settings.office_jwt_secret)}}


def _ticket(ticket: str):
    _require_editor()
    claims = _claims(ticket, "ticket:" + settings.office_jwt_secret)
    try:
        return UUID(claims["owner"]), claims["file"], UUID(hex=claims["key"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(403, "Invalid editor ticket") from None


@router.get("/office-internal/source/{ticket}", include_in_schema=False)
async def office_source(ticket: str):
    owner, name, _ = _ticket(ticket)
    artifact, path = await _source(owner, name)
    return FileResponse(path, media_type=CONTENT_TYPES[artifact.format], headers={"Cache-Control": "no-store"})


def _download_url(url: str, key: UUID) -> httpx.URL:
    reported = httpx.URL(url)
    internal = httpx.URL(settings.office_internal_url)
    public = httpx.URL(settings.office_public_url)
    path = reported.path
    segments = path.split("/")
    if ((reported.scheme, reported.host, reported.port) not in {
        (origin.scheme, origin.host, origin.port) for origin in (internal, public)
    } or not path.startswith("/cache/files/data/") or segments[4].split("_", 1)[0] != key.hex
        or any(segment in (".", "..") or "\\" in segment for segment in segments)):
        raise ValueError("Unexpected Office download URL")
    return internal.copy_with(path=path, query=reported.query)


async def _download(url: httpx.URL, fmt: str) -> bytes:
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_BYTES:
                    raise ValueError("Edited file is too large")
    with ZipFile(io.BytesIO(data)) as archive:
        for name in ("[Content_Types].xml", FORMATS[fmt][1]):
            archive.getinfo(name)
    return bytes(data)


@router.post("/office-internal/callback/{ticket}", include_in_schema=False)
async def office_callback(ticket: str, request: Request):
    owner, filename, key = _ticket(ticket)
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(403, "Editor signature required")
    payload = _claims(header.removeprefix("Bearer "), settings.office_jwt_secret).get("payload")
    if not isinstance(payload, dict) or payload.get("key") != key.hex:
        raise HTTPException(403, "Invalid editor callback")
    if payload.get("status") != 2:
        return {"error": 1 if payload.get("status") in (3, 7) else 0}
    artifact, _ = await _source(owner, filename)
    try:
        async with async_session_factory() as db:
            if await db.get(Job, key):
                return {"error": 0}
        data = await _download(_download_url(payload["url"], key), artifact.format)
    except (httpx.HTTPError, ValueError, TypeError, BadZipFile, KeyError) as exc:
        logger.warning("Office edited copy could not be retrieved: %s", type(exc).__name__)
        return {"error": 1}

    storage_name = f"{uuid4()}.{artifact.format}"
    path = artifact_path(owner, key, storage_name)
    title = f"{Path(artifact.original_name or filename).stem} (edited).{artifact.format}"
    try:
        async with async_session_factory() as db:
            db.add(Job(id=key, owner_id=owner, type="office_edit", title=title, status="done", payload={"source": filename}))
            await db.flush()
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.write_bytes(data)
            db.add(DocumentArtifactRecord(
                job_id=key, role="output", storage_name=storage_name, original_name=title,
                format=artifact.format, content_type=CONTENT_TYPES[artifact.format], size=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
            ))
            await db.commit()
    except IntegrityError:
        path.unlink(missing_ok=True)
        async with async_session_factory() as db:
            return {"error": 0 if await db.get(Job, key) else 1}
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"error": 0}
