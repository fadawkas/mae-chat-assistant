import io

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pydantic import ValidationError

from app.services.agent import CodeOutput
from app.services.artifacts import DocumentFile, Section, render_checked


def test_workspace_tool_renders_editable_widescreen_layouts():
    pytest.importorskip('quickjs')
    from codemode.runner import app

    response = TestClient(app).post('/execute', json={'code': '''
      mae.document('Launch plan.pptx', 'Launch plan', [
        {heading: 'Start with a pilot', text: 'Test with a small group before opening access.'},
        {heading: 'Three phases', layout: 'roadmap', text: 'Prepare materials\\nRun the pilot\\nReview feedback'},
        {heading: 'Review the results', layout: 'content', text: 'Check task completion.\\nReview recurring feedback.'},
      ], {summary: 'A phased rollout for the team.', slide_theme: 'forest'});
    '''})
    response.raise_for_status()
    file, = CodeOutput.model_validate_json(response.content).files
    deck = Presentation(io.BytesIO(render_checked(file)[0]))
    cover, takeaway, roadmap, content = deck.slides

    assert deck.slide_width / deck.slide_height == pytest.approx(16 / 9)
    assert cover.shapes.title.text == 'Launch plan'
    assert str(cover.background.fill.fore_color.rgb) == '1A342A'
    assert str(content.background.fill.fore_color.rgb) == 'FFFFFF'
    assert takeaway.shapes.title.text == 'Start with a pilot'
    assert roadmap.shapes.title.text == 'Three phases'
    labels = {shape.text: shape.left for shape in roadmap.shapes if shape.has_text_frame}
    assert labels['Prepare materials'] < labels['Run the pilot'] < labels['Review feedback']
    assert sum(shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE for shape in roadmap.shapes) > sum(
        shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE for shape in content.shapes
    )
    assert any(shape.has_text_frame and 'Check task completion.' in shape.text for shape in content.shapes)
    for slide in deck.slides:
        for shape in slide.shapes:
            assert 0 <= shape.left <= shape.left + shape.width <= deck.slide_width
            assert 0 <= shape.top <= shape.top + shape.height <= deck.slide_height


def test_photo_deck_embeds_webp_and_varies_composition(tmp_path):
    photo = tmp_path / "clinic.webp"
    Image.new("RGB", (640, 480), "teal").save(photo)
    file = DocumentFile(kind="document", name="talk.pptx", title="Community health", sections=[
        Section(heading="Ask questions early", text="Talk to your clinic.", image="clinic"),
        Section(heading="Bring a written list", text="Write down your questions.", image="clinic"),
        Section(heading="Support your community", text="Start a conversation.", image="clinic", layout="photo-banner"),
        Section(heading="Take the next step", text="Reach out to your local clinic.", layout="takeaway"),
    ], cover_image="clinic")
    data, checks = render_checked(file, image_files={"clinic": photo})
    deck = Presentation(io.BytesIO(data))
    photos = [
        next(shape for shape in slide.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE)
        for slide in list(deck.slides)[1:4]
    ]
    assert checks == {"image_count": 4}
    cover = deck.slides[0]
    cover_photo = next(shape for shape in cover.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE)
    assert cover.shapes.title.left + cover.shapes.title.width < cover_photo.left
    assert deck.slides[4].background.fill.fore_color.rgb == cover.background.fill.fore_color.rgb
    assert photos[0].left > photos[1].left
    assert photos[2].width > photos[0].width
    for index, picture in enumerate(photos[:2], 1):
        body = next(shape for shape in deck.slides[index].shapes if shape.has_text_frame
                    and shape.text == file.sections[index - 1].text)
        first, second = sorted((picture, body), key=lambda shape: shape.left)
        assert (second.left - first.left - first.width) / deck.slide_width > .025
    assert all(picture.image.content_type == "image/jpeg" for picture in photos)
    assert deck.slides[4].shapes.title.text == "Take the next step"

    with pytest.raises(ValueError, match="available conversation image reference"):
        render_checked(file, image_files={"other": photo})
    photo.unlink()
    with pytest.raises(ValueError, match="missing or unreadable"):
        render_checked(file, image_files={"clinic": photo})


def test_dense_slide_text_stays_editable_and_is_sized_to_fit():
    body = '\n'.join(['Review feedback and record the next step.'] * 10)
    deck = DocumentFile(kind='document', name='plan.pptx', title='Plan', sections=[
        Section(heading='Review', text=body, layout='content'),
    ])
    slide = Presentation(io.BytesIO(render_checked(deck)[0])).slides[1]
    body_box = next(shape for shape in slide.shapes if shape.has_text_frame and shape.text == body)
    size = body_box.text_frame.paragraphs[0].font.size.pt
    assert 14 <= size < 23


def test_slide_layout_rejects_bad_inputs_without_affecting_other_formats():
    with pytest.raises(ValidationError):
        Section(heading='Plan', text='Draft', layout='timeline')
    section = Section(heading='Plan', text='Draft', layout='roadmap')
    with pytest.raises(ValueError, match='2 to 4'):
        render_checked(DocumentFile(kind='document', name='plan.pptx', title='Plan', sections=[section]))
    with pytest.raises(ValueError, match='only for PPTX'):
        render_checked(DocumentFile(kind='document', name='plan.docx', title='Plan', sections=[section]))
    with pytest.raises(ValueError, match='only for PPTX'):
        render_checked(DocumentFile(kind='document', name='plan.pdf', title='Plan', slide_theme='ocean',
                                    sections=[Section(heading='Plan', text='Draft')]))
    for layout, message in [('comparison', 'four nonempty lines'), ('metric', 'two or three')]:
        with pytest.raises(ValueError, match=message):
            render_checked(DocumentFile(kind='document', name='plan.pptx', title='Plan',
                                        sections=[Section(heading='Plan', text='Draft', layout=layout)]))


def test_comparison_and_metric_use_distinct_native_layouts():
    file = DocumentFile(kind='document', name='plan.pptx', title='Plan', slide_theme='terracotta', sections=[
        Section(heading='One source of truth', layout='comparison',
                text='Today\nSeparate checklists per team\nPilot\nOne checklist with a named owner'),
        Section(heading='Start with a time box', layout='metric',
                text='4 weeks\nPilot duration\nReview feedback before expanding'),
    ])
    _, comparison, metric = Presentation(io.BytesIO(render_checked(file)[0])).slides
    boxes = {shape.text: shape for shape in comparison.shapes if shape.has_text_frame}
    assert boxes['Today'].top == boxes['Pilot'].top
    assert boxes['Today'].left < boxes['Pilot'].left
    boxes = {shape.text: shape for shape in metric.shapes if shape.has_text_frame}
    number_font = boxes['4 weeks'].text_frame.paragraphs[0].font
    assert number_font.size.pt > boxes['Pilot duration'].text_frame.paragraphs[0].font.size.pt
    assert str(number_font.color.rgb) == '9A4937'
