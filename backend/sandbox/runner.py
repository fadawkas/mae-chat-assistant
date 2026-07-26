import asyncio
import os
import shutil
import subprocess
import uuid
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

WORKSPACE_ROOT = Path("/workspaces")
FIRST_JOB_UID = 20_000
LAST_JOB_UID = 60_000
workspace_uids: dict[str, int] = {}

app = FastAPI()


class WorkspaceRequest(BaseModel):
    workspace: str


class RunRequest(BaseModel):
    workspace: str
    code: str
    output: str
    timeout: int = 90


def _workspace_root(workspace: str) -> Path:
    if not re.fullmatch(r"[0-9a-f-]{36}-[0-9a-f-]{36}", workspace):
        raise HTTPException(400, "Invalid workspace")
    root = (WORKSPACE_ROOT / workspace).resolve()
    if root.parent != WORKSPACE_ROOT:
        raise HTTPException(400, "Invalid workspace")
    return root


def _allocate_uid() -> int:
    used = set(workspace_uids.values())
    for uid in range(FIRST_JOB_UID, LAST_JOB_UID + 1):
        if uid not in used:
            return uid
    raise HTTPException(503, "Sandbox capacity reached")


def _drop_privileges(uid: int):
    def drop() -> None:
        os.setgroups([])
        os.setgid(uid)
        os.setuid(uid)

    return drop


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/workspaces")
async def provision_workspace(request: WorkspaceRequest):
    root = _workspace_root(request.workspace)
    uid = workspace_uids.get(request.workspace)
    if uid is None:
        uid = _allocate_uid()
        workspace_uids[request.workspace] = uid
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(root, uid, uid)
    os.chmod(root, 0o700)
    return {"uid": uid, "gid": uid}


@app.delete("/workspaces/{workspace}", status_code=204)
async def cleanup_workspace(workspace: str):
    root = _workspace_root(workspace)
    workspace_uids.pop(workspace, None)
    if root.exists():
        shutil.rmtree(root)


@app.post("/run")
async def run(request: RunRequest):
    root = _workspace_root(request.workspace)
    uid = workspace_uids.get(request.workspace)
    if uid is None or not root.is_dir() or Path(request.output).name != request.output:
        raise HTTPException(400, "Invalid workspace")
    script = root / "generate.py"
    output = root / request.output
    script.write_text(request.code)
    os.chown(script, uid, uid)
    os.chmod(script, 0o600)
    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", script.name, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            preexec_fn=_drop_privileges(uid),
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=request.timeout)
    except asyncio.TimeoutError:
        if proc is not None:
            proc.kill()
            await proc.wait()
        raise HTTPException(408, "Generation timed out")
    if proc.returncode != 0:
        detail = stderr.decode(errors="replace").strip().splitlines()[-1:] or ["Generated document code failed"]
        raise HTTPException(422, detail[0][:500])
    if not output.is_file() or output.resolve().parent != root:
        raise HTTPException(422, "Generated code did not create the requested file")
    return {"filename": request.output, "size": output.stat().st_size}
