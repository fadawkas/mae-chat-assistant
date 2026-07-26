import asyncio
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
ROOT = Path("/data/outputs").resolve()


class RenderRequest(BaseModel):
    tenant: str
    filename: str
    format: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/render")
async def render(request: RenderRequest):
    if Path(request.filename).name != request.filename or request.format not in {"docx", "pptx", "xlsx", "pdf"}:
        raise HTTPException(400, "Invalid render request")
    tenant_root = (ROOT / request.tenant).resolve()
    source = (tenant_root / request.filename).resolve()
    if tenant_root.parent != ROOT or source.parent != tenant_root or not source.is_file():
        raise HTTPException(404, "Artifact not found")
    render_dir = ROOT / ".renders"
    render_dir.mkdir(exist_ok=True)
    if request.format == "pdf":
        pdf = source
    else:
        profile = render_dir / f"profile-{source.stem}"
        profile.mkdir(exist_ok=True)
        process = await asyncio.create_subprocess_exec(
            "soffice", "--headless", f"-env:UserInstallation=file://{profile}",
            "--convert-to", "pdf", "--outdir", str(render_dir), str(source),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=90)
        if process.returncode != 0:
            raise HTTPException(422, stderr.decode(errors="replace")[-500:])
        pdf = render_dir / f"{source.stem}.pdf"
    if not pdf.is_file():
        raise HTTPException(422, "Renderer produced no PDF")
    process = await asyncio.create_subprocess_exec(
        "pdfinfo", str(pdf), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=20)
    if process.returncode != 0:
        raise HTTPException(422, stderr.decode(errors="replace")[-500:])
    pages = next((int(line.split(":", 1)[1].strip()) for line in stdout.decode().splitlines() if line.startswith("Pages:")), 0)
    if pages < 1:
        raise HTTPException(422, "Rendered artifact has no pages")
    thumbnail = render_dir / f"{source.stem}-preview"
    preview = thumbnail.with_suffix(".png")
    process = await asyncio.create_subprocess_exec(
        "pdftoppm", "-f", "1", "-l", "1", "-png", "-singlefile", str(pdf), str(thumbnail),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    _, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    if process.returncode != 0 or not preview.is_file():
        raise HTTPException(422, stderr.decode(errors="replace")[-500:] or "Unable to create preview")
    return {"pages": pages, "pdf": pdf.name, "preview": preview.name, "preview_size": preview.stat().st_size}
