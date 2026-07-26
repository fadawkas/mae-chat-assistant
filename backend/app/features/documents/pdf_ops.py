from pathlib import Path

from pypdf import PdfReader, PdfWriter


def merge_pdfs(inputs: list[Path], output: Path) -> int:
    writer = PdfWriter()
    for path in inputs:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported")
        for page in reader.pages:
            writer.add_page(page)
    if not writer.pages:
        raise ValueError("At least one PDF page is required")
    with output.open("wb") as handle:
        writer.write(handle)
    return len(writer.pages)


def split_pdf(source: Path, output: Path, start: int, end: int) -> int:
    reader = PdfReader(source)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are not supported")
    if start < 1 or end < start or end > len(reader.pages):
        raise ValueError("PDF page range is outside the source document")
    writer = PdfWriter()
    for page in reader.pages[start - 1:end]:
        writer.add_page(page)
    with output.open("wb") as handle:
        writer.write(handle)
    return len(writer.pages)
