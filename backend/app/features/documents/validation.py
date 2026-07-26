from pathlib import Path
from zipfile import BadZipFile, ZipFile

from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pypdf import PdfReader


def _is_single_slide_request(prompt: str) -> bool:
    normalized = prompt.lower()
    return "single slide" in normalized or "one slide" in normalized or "1 slide" in normalized


def _validate_presentation(presentation: Presentation, prompt: str) -> None:
    slides = list(presentation.slides)
    if not slides:
        raise ValueError("Presentation has no slides")
    if len(slides) == 1 and not _is_single_slide_request(prompt):
        raise ValueError("Presentation must contain multiple slides unless the request explicitly asks for one slide")

    content_slides = slides[1:] if len(slides) > 1 else slides
    visual_slides = 0
    for slide in content_slides:
        has_visual = any(
            shape.shape_type in {
                MSO_SHAPE_TYPE.AUTO_SHAPE,
                MSO_SHAPE_TYPE.CHART,
                MSO_SHAPE_TYPE.GROUP,
                MSO_SHAPE_TYPE.PICTURE,
                MSO_SHAPE_TYPE.TABLE,
            }
            for shape in slide.shapes
        )
        visual_slides += has_visual
    if len(content_slides) >= 2 and visual_slides * 2 < len(content_slides):
        raise ValueError("Presentation is too plain: use native shapes, diagrams, tables, charts, or visual compositions on most content slides")


def _validate_document(document: Document) -> None:
    paragraphs = [paragraph for paragraph in document.paragraphs if paragraph.text.strip()]
    if len(paragraphs) < 3:
        return
    heading_count = sum(
        paragraph.style.name.startswith("Heading") or paragraph.style.name == "Title"
        for paragraph in paragraphs
    )
    if heading_count == 0:
        raise ValueError("Document is too plain: add a title or heading hierarchy")


OOXML_CONTENT_TYPES = {
    "docx": b"wordprocessingml.document.main+xml",
    "pptx": b"presentationml.presentation.main+xml",
    "xlsx": b"spreadsheetml.sheet.main+xml",
}


def _validate_ooxml_package(path: Path, fmt: str) -> list[str]:
    try:
        with ZipFile(path) as package:
            names = set(package.namelist())
            if "[Content_Types].xml" not in names or "_rels/.rels" not in names:
                raise ValueError("OOXML package is missing required relationship metadata")
            if OOXML_CONTENT_TYPES[fmt] not in package.read("[Content_Types].xml"):
                raise ValueError(f"OOXML package does not contain a valid {fmt.upper()} content type")
            required = {"docx": "word/document.xml", "pptx": "ppt/presentation.xml", "xlsx": "xl/workbook.xml"}[fmt]
            if required not in names:
                raise ValueError(f"OOXML package is missing {required}")
    except BadZipFile as exc:
        raise ValueError("Generated Office file is not a valid ZIP package") from exc
    return ["valid ZIP package", "valid content types", "valid relationships"]


def validate(path: Path, fmt: str, prompt: str = "") -> list[str]:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError("No document artifact was produced")
    checks: list[str] = []
    if fmt == "docx":
        checks.extend(_validate_ooxml_package(path, fmt))
        _validate_document(Document(path))
        checks.append("document opened successfully")
    elif fmt == "pptx":
        checks.extend(_validate_ooxml_package(path, fmt))
        _validate_presentation(Presentation(path), prompt)
        checks.append("presentation opened successfully")
    elif fmt == "xlsx":
        checks.extend(_validate_ooxml_package(path, fmt))
        workbook = load_workbook(path, read_only=True)
        if not workbook.sheetnames:
            raise ValueError("Workbook has no worksheets")
        workbook.close()
        checks.append("workbook opened successfully")
    else:
        if len(PdfReader(path).pages) == 0:
            raise ValueError("PDF has no pages")
        checks.append("PDF opened successfully")
    return checks
