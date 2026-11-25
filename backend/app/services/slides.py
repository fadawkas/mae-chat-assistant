"""Render editable, widescreen PowerPoint slides from validated content."""

import io
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageOps

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

WHITE = 'FFFFFF'
# Deep background, legible accent, pale accent for dark backgrounds, panel tint.
PALETTES = {
    'ink': ('29223E', '634394', 'D7C3FF', 'F3EFFA'),
    'forest': ('1A342A', '336449', 'B8E5BB', 'E8F3EB'),
    'terracotta': ('442C25', '9A4937', 'FFC9B4', 'FBEEE9'),
    'ocean': ('102E43', '116A73', 'A8E6E9', 'E8F5F6'),
}


def render_deck(
    title: str, summary: str, sections: list[tuple[str, str, str | None, Path | None]],
    *, theme: str = 'ink', cover_image: Path | None = None,
) -> bytes:
    ink, accent, pale, tint = PALETTES[theme]
    deck = Presentation()
    deck.core_properties.title = title
    deck.slide_width = Inches(13 + 1 / 3)
    deck.slide_height = Inches(7.5)

    def block(slide, x, y, w, h, color, shape_type=MSO_SHAPE.RECTANGLE):
        shape = slide.shapes.add_shape(shape_type, *map(Inches, (x, y, w, h)))
        shape.fill.solid()
        shape.fill.fore_color.rgb = RGBColor.from_string(color)
        shape.line.fill.background()
        # Remove the Office template's effect reference (a drop shadow in Impress).
        style = shape._element.find(qn('p:style'))
        if style is not None:
            shape._element.remove(style)

    def text(slide, value, x, y, w, h, size, color=ink, *, bold=False, heading=False,
             center=False, gap=0, minimum=14, bottom=False):
        box = slide.shapes.title if heading else slide.shapes.add_textbox(0, 0, 0, 0)
        box.left, box.top, box.width, box.height = map(Inches, (x, y, w, h))
        frame = box.text_frame
        frame.word_wrap = True
        frame.vertical_anchor = MSO_ANCHOR.BOTTOM if bottom else MSO_ANCHOR.TOP
        frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
        frame.text = value
        # Allow for wrapped lines as well as explicit breaks. Size conservatively
        # so imported decks stay readable without PowerPoint's autofit engine.
        while True:
            columns = max(1, int(w * 72 / (size * .85)))
            lines = sum(max(1, len(wrap(line, columns))) for line in value.split('\n'))
            if lines * size * 1.22 + max(0, len(frame.paragraphs) - 1) * gap <= h * 72:
                break
            if size <= minimum:
                raise ValueError('Slide text does not fit at a readable size; shorten it or split it across slides')
            size -= 1
        for paragraph in frame.paragraphs:
            paragraph.level = 0
            paragraph.alignment = PP_ALIGN.CENTER if center else PP_ALIGN.LEFT
            paragraph.space_before = Pt(0)
            paragraph.space_after = Pt(gap)
            paragraph.line_spacing = 1.08
            paragraph.font.name = 'Cambria' if heading else 'Arial'
            paragraph.font.size = Pt(size)
            paragraph.font.bold = bold
            paragraph.font.color.rgb = RGBColor.from_string(color)

    def page(background):
        slide = deck.slides.add_slide(deck.slide_layouts[5])
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = RGBColor.from_string(background)
        return slide

    def photo(slide, path, x, y, w, h):
        try:
            with Image.open(path, formats=["JPEG", "PNG", "WEBP"]) as source:
                if source.width * source.height > 4_000_000:
                    raise ValueError("Slide image is too large")
                resized = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (round(w * 125), round(h * 125)))
                buffer = io.BytesIO()
                resized.save(buffer, format="JPEG", quality=89)
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError("A selected slide image is missing or unreadable") from exc
        slide.shapes.add_picture(buffer, *map(Inches, (x, y, w, h)))

    cover = page(ink)
    title_width = 5.1 if cover_image else 10.75
    if cover_image:
        photo(cover, cover_image, 6.3, .65, 6.28, 6.2)
    text(cover, title, .8, 1.3, title_width, 3.0, 58, WHITE, bold=True, heading=True, minimum=32, bottom=True)
    if summary:
        text(cover, summary, .8, 4.85, title_width, 1.45, 23, pale)

    photo_count = 0
    for index, (heading, body, layout, image) in enumerate(sections, 1):
        if image is None and layout and layout.startswith("photo-"):
            raise ValueError("A photo layout requires an available slide image")
        if image is not None:
            photo_count += 1
            if layout is None:
                layout = "photo-right" if photo_count % 2 else "photo-left"
            elif not layout.startswith("photo-"):
                raise ValueError("Use a photo layout when a slide has an image")
        if len(body) > 500 or len(body.splitlines()) > 10:
            raise ValueError('Use at most 500 characters and 10 lines per slide')
        entries = [line.strip() for line in body.splitlines() if line.strip()]
        if layout == 'roadmap' and not 2 <= len(entries) <= 4:
            raise ValueError('Use 2 to 4 nonempty lines for a roadmap, one per phase')
        if layout == 'comparison' and len(entries) != 4:
            raise ValueError('Use four nonempty lines for a comparison: two label and copy pairs')
        if layout == 'metric' and not 2 <= len(entries) <= 3:
            raise ValueError('Use two or three nonempty lines for a metric: figure, label, and optional context')

        takeaway = layout == 'takeaway' or (layout is None and len(entries) == 1 and len(body) <= 100)
        dark = takeaway and index == len(sections)
        slide = page(ink if dark else WHITE)
        text(slide, heading or title, .8, .7, 11.7, 1.44, 41, WHITE if dark else ink,
             bold=True, heading=True, minimum=28)
        text(slide, f'{index:02d}', 11.98, 6.96, .53, .3, 11, pale if dark else accent)

        if image is not None and layout == "photo-banner":
            photo(slide, image, .8, 2.24, 11.7, 3.6 if body else 4.42)
            if body:
                text(slide, body, .8, 6.04, 11.7, .64, 18)
        elif image is not None:
            photo_x, text_x = (.8, 8.05) if layout == "photo-left" else (5.65, .8)
            photo(slide, image, photo_x, 2.24, 6.85, 4.42)
            text(slide, body, text_x, 2.82, 4.44, 3.56, 25, gap=8)
        elif layout == 'roadmap':
            width = 11.7 / len(entries)
            # The connector represents sequence rather than decorating an edge.
            block(slide, 1.17, 3.03, (len(entries) - 1) * width, .035, pale)
            for step, entry in enumerate(entries):
                x = .8 + step * width
                block(slide, x, 2.68, .74, .74, accent, MSO_SHAPE.OVAL)
                text(slide, str(step + 1), x, 2.84, .74, .37, 20, WHITE, bold=True, center=True)
                text(slide, entry, x, 3.72, width - .34, 2.5, 22)
        elif layout == 'comparison':
            for column in range(2):
                x = .8 + column * 6
                block(slide, x, 2.31, 5.7, 3.98, tint, MSO_SHAPE.ROUNDED_RECTANGLE)
                text(slide, entries[column * 2], x + .34, 2.63, 5.02, .94, 24, accent, bold=True)
                text(slide, entries[column * 2 + 1], x + .34, 3.74, 5.02, 2.15, 22)
        elif layout == 'metric':
            text(slide, entries[0], .8, 2.34, 11.7, 1.65, 88, accent, bold=True, minimum=36)
            text(slide, entries[1], .8, 4.14, 10.7, .88, 26, bold=True)
            if len(entries) == 3:
                text(slide, entries[2], .8, 5.25, 10.7, 1.3, 20)
        elif takeaway:
            text(slide, body, .8, 2.58, 10.9, 3.76, 38, pale if dark else accent, bold=True, gap=8)
        else:
            text(slide, body, .8, 2.53, 10.9, 3.75, 24, gap=12 if len(entries) <= 4 else 0)

    buffer = io.BytesIO()
    deck.save(buffer)
    return buffer.getvalue()
