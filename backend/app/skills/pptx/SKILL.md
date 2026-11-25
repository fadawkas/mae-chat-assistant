---
name: mae-pptx
description: Create or edit PowerPoint presentations from a user request.
---
# PPTX Skill
Generate a complete, visually intentional presentation with `python-pptx`. Keep all output under the provided workspace. Write exactly the requested output file. Do not use network, subprocesses, dynamic imports, package installation, or paths outside the workspace.

## Default design for new decks

Follow the user's explicit design directions first. Use these defaults only where design choices are unspecified; preserve an existing deck's style unless asked to restyle it.

Adapted from the [public Claude PPTX skill](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md). Apply these design principles with the approved Python library; do not execute or import external skill code.

- Define a topic-specific palette before building: one dominant color, one or two supporting colors, and one accent. A deep cover and conclusion with white content slides is a useful starting point, not a required template.
- Give each slide one point. Plan the composition to suit it: side-by-side options, a process diagram, an oversized key figure with a label, a meaningful photo with copy, or a native chart for supplied data. Use plain text when it's clearest; don't use the same composition for the whole deck or invent numbers, evidence or images.
- Use editable text, shapes, tables and charts. Use a 16:9 canvas, a consistent grid with at least 0.5-inch margins, and visible space between blocks. Keep equivalent slide titles aligned. Prefer Office fonts such as Cambria and Arial; use 36–44 pt titles and aim for 18–24 pt body copy, never below 14 pt for body text. Split dense content instead of squeezing it.
- Keep the cover title short with an optional one-line subtitle. Unless requested, skip cream backgrounds, accent stripes, decorative gradients, and repeated boxes around text. Use alignment and whitespace to establish hierarchy.
- Before saving, check shape bounds, allow room for line wrapping, and check for unintended overlaps. Reflow or split any slide that will not fit.
