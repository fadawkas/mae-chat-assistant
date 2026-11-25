from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from pptx import Presentation

from app.services import artifacts


@pytest.mark.asyncio
async def test_repeated_deck_name_keeps_first_file_per_run(tmp_path, monkeypatch):
    monkeypatch.setattr(artifacts.settings, 'output_dir', str(tmp_path))
    owner, run = uuid4(), uuid4()
    jobs = []
    records = []

    class Session:
        async def scalar(self, statement):
            run_id = statement.compile().params['id_1']
            return next((job for job in jobs if job.id == run_id), None)

        async def scalars(self, statement):
            run_id = statement.compile().params['job_id_1']
            return [record.original_name for record in records if record.job_id == run_id]

        def add(self, record):
            (jobs if isinstance(record, artifacts.Job) else records).append(record)

        async def flush(self):
            pass

        async def commit(self):
            pass

    @asynccontextmanager
    async def session():
        yield Session()

    def deck(name, title):
        return artifacts.DocumentFile(kind='document', name=name, title=title, sections=[
            artifacts.Section(heading='Next step', text='Run a pilot.'),
        ])

    monkeypatch.setattr(artifacts, 'async_session_factory', session)
    original = deck('Plan.pptx', 'Original plan')
    retry = deck('plan.pptx', 'Retry must not overwrite the original')
    separate = deck('Plan v2.pptx', 'Separate version')
    first, = await artifacts.save_artifacts(owner, run, [original, retry], routine=False)
    second, = await artifacts.save_artifacts(owner, run, [retry, separate], routine=False)
    assert await artifacts.save_artifacts(owner, run, [original], routine=False) == []
    assert {first['display_name'], second['display_name']} == {'Plan.pptx', 'Plan v2.pptx'}
    assert len(records) == 2
    path = artifacts.artifact_path(owner, run, first['filename'])
    assert Presentation(path).slides[0].shapes.title.text == 'Original plan'
    assert len(list(path.parent.iterdir())) == 2
    (later,) = await artifacts.save_artifacts(owner, uuid4(), [original], routine=False)
    assert later['filename'] != first['filename']
