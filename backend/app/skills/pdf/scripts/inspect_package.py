"""Report basic PDF metadata for local validation."""
from pathlib import Path
from pypdf import PdfReader
import sys

reader = PdfReader(Path(sys.argv[1]))
print(f"pages={len(reader.pages)}")
