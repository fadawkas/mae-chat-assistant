# DOCX Editing Workflow

Edits must preserve the uploaded OOXML package. Inspect the document first,
change only requested paragraphs, tables, styles, or relationships, then write
the package back and validate it. Do not rebuild an edited document from plain
text when the source contains formatting, images, headers, or footers.

Use `scripts/inspect_package.py` before and after an edit to confirm the
required package parts and relationships remain present.
