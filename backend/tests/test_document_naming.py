import json
from unittest.mock import AsyncMock

import pytest

from app.features.documents import agent
from app.services.artifacts import artifact_title, download_filename


@pytest.mark.asyncio
@pytest.mark.parametrize(('extension', 'explicit_title', 'expected_filename'), [
    ('pptx', '', 'new-hire-onboarding-pilot.pptx'),
    ('docx', 'Team Onboarding Guide', 'team-onboarding-guide.docx'),
])
async def test_document_generation_uses_subject_title_or_explicit_title(monkeypatch, extension, explicit_title, expected_filename):
    code = 'from pptx import Presentation' if extension == 'pptx' else 'from docx import Document'
    client = AsyncMock()
    client.complete.return_value = json.dumps({'title': 'New Hire Onboarding Pilot', 'code': code})
    monkeypatch.setattr(agent, 'OpenRouterClient', lambda _: client)

    generated, title = await agent.generate_code(extension, explicit_title, 'Introduce the pilot.', '', model='test')

    assert generated == code
    assert download_filename(title, extension) == expected_filename
    messages = client.complete.await_args.args[1]
    assert 'short title describing the artifact' in messages[0]['content']
    if explicit_title:
        assert f'Explicit title: {explicit_title}' in messages[1]['content']


def test_filename_cannot_contain_directories_or_repeat_the_extension():
    title = artifact_title('Safety / Onboarding.PPTX', 'pptx')
    assert title == 'Safety Onboarding'
    assert download_filename(title, 'pptx') == 'safety-onboarding.pptx'
