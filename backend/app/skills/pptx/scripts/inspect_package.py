"""Print the package parts used by a PPTX for local validation."""
from pathlib import Path
from zipfile import ZipFile
import sys

with ZipFile(Path(sys.argv[1])) as package:
    for name in sorted(package.namelist()):
        print(name)
