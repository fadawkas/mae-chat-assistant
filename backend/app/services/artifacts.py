"""Validated file effects from code mode and owner-scoped artifact storage."""

import asyncio
import hashlib
import io
import re
from html import escape
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models import DocumentArtifactRecord, Job

MAX_FILES = 8
IMAGE_CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
CONTENT_TYPES = {
    **IMAGE_CONTENT_TYPES,
    "txt": "text/plain",
    "md": "text/markdown",
    "csv": "text/csv",
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}
NAME = re.compile(r"[\w][\w .()-]{0,119}", re.UNICODE)
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


class OutputFile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str

    @property
    def extension(self) -> str:
        return self.name.rsplit(".", 1)[-1].lower()

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not NAME.fullmatch(value) or "." not in value:
            raise ValueError("Use a plain filename with an extension (no directories)")
        return value


class TextFile(OutputFile):
    kind: Literal["text"]
    text: str = Field(max_length=64_000)


class Table(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    headers: list[Annotated[str, StringConstraints(max_length=80)]] = Field(min_length=1, max_length=6)
    rows: list[Annotated[list[Annotated[str, StringConstraints(max_length=200)]], Field(max_length=6)]] = Field(min_length=1, max_length=24)


class Section(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    heading: str = Field(max_length=120)
    text: str = Field(max_length=2_000)
    table: Table | None = None
    layout: Literal["content", "takeaway", "roadmap", "comparison", "metric", "photo-left", "photo-right", "photo-banner"] | None = None
    image: str | None = Field(default=None, max_length=64)


class DocumentFile(OutputFile):
    kind: Literal["document"]
    title: str = Field(min_length=1, max_length=120)
    sections: list[Section] = Field(min_length=1, max_length=16)
    summary: str = Field(default="", max_length=400)
    max_pages: Literal[1] | None = None
    slide_theme: Literal["ink", "forest", "terracotta", "ocean"] | None = None
    cover_image: str | None = Field(default=None, max_length=64)


Cell = Annotated[str, StringConstraints(max_length=1_000)] | int | float | bool | None
Row = Annotated[list[Cell], Field(min_length=1, max_length=24)]


class SpreadsheetOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    formats: list[Literal["general", "usd", "percent"]] = Field(default_factory=list, max_length=24)
    total_row: bool = False


class SpreadsheetFile(OutputFile):
    kind: Literal["spreadsheet"]
    rows: list[Row] = Field(min_length=1, max_length=250)
    options: SpreadsheetOptions = Field(default_factory=SpreadsheetOptions)


FileEffect = Annotated[TextFile | DocumentFile | SpreadsheetFile, Field(discriminator="kind")]


def _plain(value: str) -> str:
    if INVALID_XML.search(value):
        raise ValueError("Document content contains unsupported control characters")
    return value


def _render(file: FileEffect, *, image_files: dict[str, Path] | None = None) -> bytes:
    """Render data, never model-supplied HTML, templates or executable code."""
    fmt = file.extension
    if isinstance(file, TextFile) and fmt in {"txt", "md", "csv", "json"}:
        return file.text.encode("utf-8")
    if isinstance(file, SpreadsheetFile) and fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter

        book = Workbook()
        sheet = book.active
        for row_number, row in enumerate(file.rows, 1):
            for col_number, value in enumerate(row, 1):
                cell = sheet.cell(row_number, col_number, _plain(value) if isinstance(value, str) else value)
                if isinstance(value, str):
                    cell.data_type = "s"  # Don't turn generated strings into Excel formulas.
                if row_number > 1 and isinstance(value, (int, float)) and not isinstance(value, bool):
                    formats = file.options.formats
                    if col_number <= len(formats):
                        cell.number_format = {"general": "General", "usd": '"$"#,##0.00', "percent": "0.0%"}[formats[col_number - 1]]
                cell.alignment = Alignment(vertical="center", wrap_text=True)
                if row_number == 1:
                    cell.fill = PatternFill("solid", fgColor="18394A")
                    cell.font = Font(color="FFFFFF", bold=True)
                elif file.options.total_row and row_number == len(file.rows):
                    cell.fill = PatternFill("solid", fgColor="DAEBE9")
                    cell.font = Font(color="18394A", bold=True)
                elif row_number % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="F0F5F7")
        for column in sheet.columns:
            width = max((len(str(cell.value)) for cell in column if cell.value is not None), default=0)
            sheet.column_dimensions[get_column_letter(column[0].column)].width = min(48, max(14, width + 4))
        sheet.freeze_panes = "A2"
        buffer = io.BytesIO()
        book.save(buffer)
        return buffer.getvalue()
    if not isinstance(file, DocumentFile) or fmt not in {"docx", "pptx", "pdf"}:
        raise ValueError("The filename extension does not match a supported file format")

    title = _plain(file.title)
    summary = _plain(file.summary)
    sections = [(_plain(section.heading), _plain(section.text), section.table) for section in file.sections]
    for _, _, table in sections:
        if table and any(len(row) != len(table.headers) for row in table.rows):
            raise ValueError("Each table row must match the number of headers")
    if file.max_pages and fmt != "pdf":
        raise ValueError("max_pages is available only for PDF")
    if fmt != "pptx" and (
        file.slide_theme or file.cover_image is not None
        or any(section.layout or section.image is not None for section in file.sections)
    ):
        raise ValueError("Slide themes, layouts and images are available only for PPTX")
    if fmt == "pptx" and any(table for _, _, table in sections):
        raise ValueError("Use short slide text instead of tables in PPTX")
    if fmt == "docx":
        from docx import Document

        doc = Document()
        doc.add_heading(title, 0)
        if summary:
            doc.add_paragraph(summary, style="Subtitle")
        for heading, text, table in sections:
            if heading:
                doc.add_heading(heading, 1)
            for paragraph in text.split("\n"):
                if paragraph:
                    doc.add_paragraph(paragraph)
            if table:
                grid = doc.add_table(rows=0, cols=len(table.headers))
                grid.style = "Light Shading Accent 1"
                for values in [table.headers, *table.rows]:
                    for cell, value in zip(grid.add_row().cells, values, strict=True):
                        cell.text = _plain(value)
        buffer = io.BytesIO()
        doc.save(buffer)
        return buffer.getvalue()
    if fmt == "pptx":
        from app.services.slides import render_deck

        return render_deck(title, summary, [
            (heading, text, section.layout, _slide_image(section.image, image_files))
            for (heading, text, _), section in zip(sections, file.sections, strict=True)
        ], theme=file.slide_theme or "ink", cover_image=_slide_image(file.cover_image, image_files))

    from weasyprint import HTML

    def deny_fetch(url, *args, **kwargs):
        raise ValueError("External PDF resources are disabled")

    def table_html(table: Table) -> str:
        headers = "".join(f"<th scope='col'>{escape(_plain(value))}</th>" for value in table.headers)
        rows = "".join(
            "<tr>" + "".join(f"<td>{escape(_plain(value))}</td>" for value in row) + "</tr>"
            for row in table.rows
        )
        return f"<table><thead><tr>{headers}</tr></thead><tbody>{rows}</tbody></table>"

    body = "".join(
        "<section>" + (f"<h2>{escape(heading)}</h2>" if heading else "")
        + (f"<p>{escape(text)}</p>" if text else "")
        + (table_html(table) if table else "") + "</section>"
        for heading, text, table in sections
    )
    takeaway = f'<p class="summary">{escape(summary)}</p>' if summary else ""
    return HTML(
        string=(
            '<meta charset="utf-8"><style>'
            '@page { size: A4; margin: 20mm; } body { font: 11pt sans-serif; color: #203045; } '
            'h1 { font-size: 26pt; color: #18394a; border-top: 4pt solid #276966; padding-top: 10pt; } '
            'h2 { font-size: 14pt; break-after: avoid; } '
            'p, td, th { overflow-wrap: anywhere; line-height: 1.45; } p { white-space: pre-wrap; } '
            '.summary { background: #e8f2f0; border-left: 3pt solid #276966; padding: 10pt; break-inside: avoid; } '
            'table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8pt 0 14pt; } '
            'th, td { text-align: left; padding: 6pt; border-bottom: 1pt solid #d6e4e8; } '
            'th { color: white; background: #18394a; } tbody tr:nth-child(even) { background: #f0f5f7; } '
            'tr { break-inside: avoid; }'
            f'</style><h1>{escape(title)}</h1>{takeaway}{body}'
        ),
        url_fetcher=deny_fetch,
    ).write_pdf()


def artifact_title(value: str, extension: str = "") -> str:
    value = value.strip()
    if extension and value.lower().endswith(f".{extension}"):
        value = value[:-(len(extension) + 1)]
    words = re.sub(r"[^\w .()-]", " ", value)
    return " ".join(words.split()).strip(" ._-")[:60].rstrip(" ._-")


def download_filename(name: str, extension: str) -> str:
    stem = artifact_title(name, extension)
    slug = re.sub(r"[^\w]+|_+", "-", stem.lower()).strip("-") or "artifact"
    if re.fullmatch(r"con|prn|aux|nul|com[1-9]|lpt[1-9]", slug):
        slug = f"file-{slug}"
    return f"{slug}.{extension}"


def artifact_download_name(record: DocumentArtifactRecord) -> str:
    name = record.original_name or record.storage_name
    if record.role == "output" and record.original_name and (
        record.format in {"docx", "pptx", "pdf", "xlsx"} or record.content_type in IMAGE_CONTENT_TYPES.values()
    ):
        return download_filename(name, record.format)
    return name


def describe_artifact(record: DocumentArtifactRecord) -> dict:
    name = record.original_name or record.storage_name
    if record.content_type in IMAGE_CONTENT_TYPES.values():
        name = Path(name).stem
        if re.fullmatch(r"generated-image(?:-\d+)?", name):
            name = "Generated image"
    return {
        "filename": record.storage_name,
        "display_name": name,
        "content_type": record.content_type or "application/octet-stream",
        "size": record.size,
        "download_url": f"/api/files/{record.storage_name}",
        "download_name": artifact_download_name(record),
    }


def artifact_path(owner_id: UUID, job_id: UUID, filename: str, *, legacy: bool = False) -> Path:
    if Path(filename).name != filename or filename in {"", ".", ".."}:
        raise ValueError("Invalid storage filename")
    base = Path(settings.output_dir).resolve()
    directory = base / str(owner_id)
    if not legacy:
        directory /= str(job_id)
    path = directory / filename
    if path.resolve() != path:
        raise ValueError("Invalid artifact storage path")
    return path


def _slide_image(reference: str | None, image_files: dict[str, Path] | None) -> Path | None:
    if reference is None:
        return None
    if not image_files or reference not in image_files:
        raise ValueError("Use an available conversation image reference, not an image label or URL")
    return image_files[reference]


def render_checked(file: FileEffect, *, image_files: dict[str, Path] | None = None) -> tuple[bytes, dict]:
    data = _render(file, image_files=image_files)
    if isinstance(file, SpreadsheetFile):
        from openpyxl import load_workbook

        workbook = load_workbook(io.BytesIO(data), read_only=True)
        try:
            sheet = workbook.active
            rows = list(sheet.iter_rows(min_row=1, max_row=min(4, sheet.max_row), max_col=min(12, sheet.max_column), values_only=True))
            return data, {
                "row_count": sheet.max_row, "column_count": sheet.max_column,
                "preview": [[cell[:120] if isinstance(cell, str) else cell for cell in row] for row in rows],
            }
        finally:
            workbook.close()
    if isinstance(file, DocumentFile) and file.extension == "pptx":
        return data, {"image_count": int(file.cover_image is not None) + sum(section.image is not None for section in file.sections)}
    if file.extension != "pdf":
        return data, {}

    from pypdf import PdfReader

    pages = len(PdfReader(io.BytesIO(data)).pages)
    if isinstance(file, DocumentFile) and file.max_pages and pages > file.max_pages:
        raise ValueError(f"{file.name} rendered to {pages} pages; shorten it to one page and retry")
    return data, {"page_count": pages}


def validate_image(data: bytes, media_type: str) -> str:
    from PIL import Image

    extensions = {mime: ext for ext, mime in IMAGE_CONTENT_TYPES.items()}
    extension = extensions.get(media_type)
    if extension is None:
        raise ValueError("Unsupported image type")
    try:
        with Image.open(io.BytesIO(data), formats=[{"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}[extension]]) as image:
            if image.width * image.height > 4_000_000 or getattr(image, "is_animated", False):
                raise ValueError("Unsupported image dimensions or animation")
            image.verify()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid image data") from exc
    return extension


async def save_image(owner_id: UUID, run_id: UUID, data: bytes, media_type: str, *, title: str) -> dict:
    extension = await asyncio.to_thread(validate_image, data, media_type)
    return (await _save_rendered(owner_id, run_id, [(f"{title}.{extension}", extension, data, {})], routine=False))[0]


async def save_artifacts(owner_id: UUID, run_id: UUID, files: list[FileEffect], *, routine: bool,
                         image_files: dict[str, Path] | None = None) -> list[dict]:
    if not files:
        return []
    rendered = await asyncio.to_thread(lambda: [
        (file.name, file.extension, *render_checked(file, image_files=image_files)) for file in files
    ])
    return await _save_rendered(owner_id, run_id, rendered, routine=routine)


async def _save_rendered(owner_id: UUID, run_id: UUID, rendered: list[tuple[str, str, bytes, dict]], *, routine: bool) -> list[dict]:
    written: list[Path] = []
    try:
        async with async_session_factory() as db:
            job = await db.scalar(select(Job).where(Job.id == run_id, Job.owner_id == owner_id).with_for_update())
            saved_names = set()
            if job is None:
                if routine:
                    raise ValueError("Routine run no longer exists")
                job = Job(id=run_id, owner_id=owner_id, type="agent", title=rendered[0][0], status="done")
                db.add(job)
                await db.flush()
            else:
                if job.type == "chat" and job.status != "in_progress":
                    raise ValueError("Chat run has stopped")
                names = await db.scalars(select(DocumentArtifactRecord.original_name).where(
                    DocumentArtifactRecord.job_id == job.id, DocumentArtifactRecord.role == "output",
                ))
                saved_names.update(name.casefold() for name in names if name is not None)

            records = []
            for name, extension, data, checks in rendered:
                # A repeated tool call can render different bytes for the same deliverable.
                # Keep the first file and emit events only for newly saved files.
                key = name.casefold()
                if key in saved_names:
                    continue
                saved_names.add(key)
                storage_name = f"{uuid4()}.{extension}"
                path = artifact_path(owner_id, run_id, storage_name)
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with path.open("xb") as output:
                    written.append(path)
                    output.write(data)
                record = DocumentArtifactRecord(
                    job_id=job.id, role="output", storage_name=storage_name,
                    original_name=name, format=extension,
                    content_type=CONTENT_TYPES[extension], size=len(data),
                    sha256=hashlib.sha256(data).hexdigest(),
                )
                records.append({**describe_artifact(record), **checks})
                db.add(record)
            await db.commit()
            return records
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
