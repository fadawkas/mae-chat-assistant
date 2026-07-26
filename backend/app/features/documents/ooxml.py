import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def _replacement(prompt: str) -> tuple[str, str]:
    match = re.search(r"replace\s+[\"'](?P<old>.+?)[\"']\s+with\s+[\"'](?P<new>.*?)[\"']", prompt, re.IGNORECASE)
    if not match:
        raise ValueError("Office edits must use: replace 'old text' with 'new text'")
    return match.group("old"), match.group("new")


def replace_text_preserving_package(source: Path, output: Path, prompt: str, fmt: str) -> list[str]:
    old, new = _replacement(prompt)
    changed: list[str] = []
    with ZipFile(source) as original, ZipFile(output, "w", ZIP_DEFLATED) as edited:
        for info in original.infolist():
            data = original.read(info.filename)
            if info.filename.endswith(".xml") and old.encode() in data:
                data = data.replace(old.encode(), new.encode())
                changed.append(info.filename)
            edited.writestr(info, data)
    if not changed:
        raise ValueError(f"Text {old!r} was not found in the {fmt.upper()} package")
    return changed
