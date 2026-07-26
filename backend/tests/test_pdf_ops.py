from pathlib import Path

import pytest

from app.features.documents.pdf_ops import split_pdf


def test_split_rejects_invalid_page_range(tmp_path: Path) -> None:
    source = tmp_path / "source.pdf"
    source.write_bytes(b"not a pdf")
    with pytest.raises(Exception):
        split_pdf(source, tmp_path / "output.pdf", 0, 1)
