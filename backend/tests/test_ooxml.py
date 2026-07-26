from pathlib import Path
from zipfile import ZipFile

from app.features.documents.ooxml import replace_text_preserving_package


def test_replace_text_preserves_unrelated_package_parts(tmp_path: Path) -> None:
    source = tmp_path / "source.docx"
    output = tmp_path / "output.docx"
    with ZipFile(source, "w") as package:
        package.writestr("word/document.xml", b"<w:t>before</w:t>")
        package.writestr("word/media/image.bin", b"unchanged")
    changed = replace_text_preserving_package(source, output, "replace 'before' with 'after'", "docx")
    with ZipFile(output) as package:
        assert package.read("word/document.xml") == b"<w:t>after</w:t>"
        assert package.read("word/media/image.bin") == b"unchanged"
    assert changed == ["word/document.xml"]
