from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, MetaData, Table, create_engine, insert, select
from sqlalchemy.orm import Session

from app.api.routes import jobs
from app.core.auth import current_user
from app.core.config import settings
from app.models import DocumentArtifactRecord, Job
from app.services.artifacts import artifact_path


@pytest.mark.parametrize('job_type', ['agent', 'document'])
def test_delete_only_owned_artifact(job_type, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'output_dir', str(tmp_path / 'output'))
    engine = create_engine(f'sqlite:///{tmp_path / "artifacts.db"}')
    # These routes only join on these Job columns; the rest use PostgreSQL types.
    job_table = Table('jobs', MetaData(), *(
        Column(column.name, column.type, primary_key=column.primary_key)
        for column in (Job.__table__.c.id, Job.__table__.c.owner_id, Job.__table__.c.type)
    ))
    job_table.create(engine)
    DocumentArtifactRecord.__table__.create(engine)
    owners = [uuid4(), uuid4()]
    run, other_run = uuid4(), uuid4()
    with Session(engine) as db:
        db.execute(insert(job_table), [
            {'id': run, 'owner_id': owners[0], 'type': job_type},
            {'id': other_run, 'owner_id': owners[1], 'type': 'agent'},
        ])
        for owner, job_id, filename, role in [
            (owners[0], run, 'target.pdf', 'output'),
            (owners[0], run, 'target.pdf.png', 'preview'),
            (owners[0], run, 'sibling.pdf', 'output'),
            (owners[1], other_run, 'private.pdf', 'output'),
            (owners[0], run, 'owned.png', 'output'),
            (owners[1], other_run, 'private.png', 'output'),
        ]:
            path = artifact_path(owner, job_id, filename, legacy=job_id == run and job_type == 'document')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'file')
            names = {'owned.png': 'Misty Mountain Trail.png', 'target.pdf': 'Onboarding Pilot.pdf'}
            db.add(DocumentArtifactRecord(job_id=job_id, role=role, storage_name=filename,
                                          original_name=names.get(filename),
                                          format=filename.rsplit('.', 1)[-1], size=4, sha256='test',
                                          content_type='image/png' if filename.endswith('.png') else 'application/pdf'))
        db.commit()

    @asynccontextmanager
    async def session():
        with Session(engine) as db:
            yield SimpleNamespace(**{
                name: AsyncMock(side_effect=getattr(db, name))
                for name in ('execute', 'scalars', 'delete', 'commit')
            })

    monkeypatch.setattr(jobs, 'async_session_factory', session)
    app = FastAPI()
    app.include_router(jobs.router)
    app.dependency_overrides[current_user] = lambda: SimpleNamespace(id=owners[0])
    target = '/api/artifacts/target.pdf'
    same_origin = {'Origin': 'http://testserver'}
    with TestClient(app) as client:
        assert client.delete(target).status_code == 403
        assert client.delete('/api/artifacts/private.pdf', headers=same_origin).status_code == 404
        assert client.delete('/api/artifacts/target.pdf.png', headers=same_origin).status_code == 404
        pdf = client.get('/api/files/target.pdf')
        assert pdf.content == b'file'
        assert pdf.headers['content-disposition'] == 'attachment; filename="onboarding-pilot.pdf"'
        assert client.get('/api/files/private.png?inline=true').status_code == 404
        preview = client.get('/api/files/owned.png?inline=true')
        assert preview.status_code == 200 and preview.headers['content-type'] == 'image/png'
        assert preview.headers['content-disposition'].startswith('inline;')
        assert preview.headers['cache-control'] == 'private, no-store'
        assert client.get('/api/files/owned.png').headers['content-disposition'] == (
            'attachment; filename="misty-mountain-trail.png"'
        )
        image = next(row for row in client.get('/api/artifacts').json() if row['filename'] == 'owned.png')
        assert image['display_name'] == 'Misty Mountain Trail'
        assert image['download_name'] == 'misty-mountain-trail.png'
        assert client.delete(target, headers=same_origin).status_code == 204
        assert client.delete(target, headers=same_origin).status_code == 404
        assert client.get('/api/files/target.pdf').status_code == 404
        assert {row['filename'] for row in client.get('/api/artifacts').json()} == {'sibling.pdf', 'owned.png'}
        if job_type == 'document':
            assert client.get('/api/files/target.pdf.png').status_code == 404

    legacy = job_type == 'document'
    assert not artifact_path(owners[0], run, 'target.pdf', legacy=legacy).exists()
    assert artifact_path(owners[0], run, 'target.pdf.png', legacy=legacy).exists() is not legacy
    assert artifact_path(owners[0], run, 'sibling.pdf', legacy=legacy).is_file()
    assert artifact_path(owners[1], other_run, 'private.pdf').is_file()
    with Session(engine) as db:
        assert db.scalar(select(job_table.c.id).where(job_table.c.id == run)) == run
