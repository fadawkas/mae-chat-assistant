import time
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import office
from app.core.auth import current_user, require_csrf
from app.core.config import settings
from app.models import DocumentArtifactRecord, Job


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(settings, 'office_jwt_secret', 'test-only-editor-signature-key-over-32')
    monkeypatch.setattr(settings, 'office_public_url', 'http://localhost:8081')
    user = SimpleNamespace(id=uuid4(), first_name='Test', last_name='Editor')
    artifact = SimpleNamespace(format='xlsx', original_name='Budget.xlsx')

    async def source(owner, filename):
        assert owner == user.id and filename == 'budget.xlsx'
        return artifact, Path('unused')

    monkeypatch.setattr(office, '_source', source)
    app = FastAPI()
    app.include_router(office.router)
    app.dependency_overrides[current_user] = lambda: user
    app.dependency_overrides[require_csrf] = lambda: None
    return TestClient(app), user


def test_session_config_signs_file_and_rejects_forged_or_expired_tickets(setup):
    client, user = setup
    response = client.post('/api/artifacts/budget.xlsx/editor')
    assert response.status_code == 200
    config = response.json()['config']
    assert config['documentType'] == 'cell'
    assert config['editorConfig']['mode'] == 'edit'
    assert office._claims(config['token'], settings.office_jwt_secret)['document'] == config['document']
    ticket = config['document']['url'].split('/')[-1]
    assert office._ticket(ticket)[0] == user.id
    assert client.get('/office-internal/source/' + ticket + 'x').status_code == 403
    expired = office._token({'exp': time.time() - 1}, 'ticket:' + settings.office_jwt_secret)
    assert client.get('/office-internal/source/' + expired).status_code == 403


def test_callback_saves_one_new_artifact_and_leaves_source_untouched(setup, tmp_path, monkeypatch):
    client, user = setup
    config = client.post('/api/artifacts/budget.xlsx/editor').json()['config']
    key = config['document']['key']
    callback = '/office-internal/callback/' + config['editorConfig']['callbackUrl'].split('/')[-1]
    source = tmp_path / 'original.xlsx'
    source.write_bytes(b'original')
    monkeypatch.setattr(settings, 'output_dir', str(tmp_path))
    saved = []
    downloads = []

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, model, id_):
            return next((obj for obj in saved if isinstance(obj, model) and obj.id == id_), None)

        def add(self, obj):
            saved.append(obj)

        async def flush(self):
            pass

        async def commit(self):
            pass

    async def download(url, fmt):
        assert url.host == 'mae-office' and fmt == 'xlsx'
        downloads.append(url)
        return b'edited'

    monkeypatch.setattr(office, 'async_session_factory', Session)
    monkeypatch.setattr(office, '_download', download)

    def signed(url):
        token = office._token({'payload': {'key': key, 'status': 2, 'url': url}}, settings.office_jwt_secret)
        return {'Authorization': 'Bearer ' + token}

    assert client.post(callback).status_code == 403
    assert client.post(callback, headers=signed('http://untrusted/cache/files/data/' + key + '/output.xlsx')).json() == {'error': 1}
    assert client.post(callback, headers=signed('http://localhost:8081/cache/files/data/wrong/output.xlsx')).json() == {'error': 1}
    headers = signed('http://localhost:8081/cache/files/data/' + key + '_cache/output.xlsx?signature=example')
    assert client.post(callback, headers=headers).json() == {'error': 0}
    assert client.post(callback, headers=headers).json() == {'error': 0}
    assert len(downloads) == 1 and len(saved) == 2
    job, record = saved
    assert isinstance(job, Job) and job.owner_id == user.id
    assert isinstance(record, DocumentArtifactRecord) and record.original_name == 'Budget (edited).xlsx'
    assert (tmp_path / str(user.id) / str(job.id) / record.storage_name).read_bytes() == b'edited'
    assert source.read_bytes() == b'original'
