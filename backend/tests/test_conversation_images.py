from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import Column, MetaData, Table, create_engine, insert
from sqlalchemy.orm import Session

from app.services import chat_runs
from app.models import Conversation, DocumentArtifactRecord, Job, Message


@pytest.mark.asyncio
async def test_slide_image_inventory_only_includes_owned_outputs_from_this_chat(monkeypatch):
    engine = create_engine('sqlite://')
    jobs = Table('jobs', MetaData(), *(
        Column(column.name, column.type, primary_key=column.primary_key)
        for column in (Job.__table__.c.id, Job.__table__.c.owner_id)
    ))
    for table in (jobs, Conversation.__table__, Message.__table__, DocumentArtifactRecord.__table__):
        table.create(engine)

    owner, other_owner, conversation, other_conversation, run, other_run = (uuid4() for _ in range(6))
    with Session(engine) as db:
        db.execute(insert(jobs), [{'id': run, 'owner_id': owner}, {'id': other_run, 'owner_id': other_owner}])
        db.add_all([
            Conversation(id=conversation, owner_id=owner),
            Conversation(id=other_conversation, owner_id=owner),
            Message(conversation_id=conversation, role='assistant', content='', artifact_run_id=run),
            Message(conversation_id=conversation, role='assistant', content='', artifact_run_id=other_run),
        ])
        for run_id, name, role, mime in [
            (run, 'photo.webp', 'output', 'image/webp'),
            (run, 'preview.png', 'preview', 'image/png'),
            (run, 'notes.txt', 'output', 'text/plain'),
            (other_run, 'private.webp', 'output', 'image/webp'),
        ]:
            db.add(DocumentArtifactRecord(job_id=run_id, storage_name=name, original_name=name,
                                          role=role, content_type=mime, format=name.split('.')[-1],
                                          size=10, sha256='test'))
        db.commit()

    @asynccontextmanager
    async def session():
        with Session(engine) as db:
            yield type('Db', (), {'execute': AsyncMock(side_effect=db.execute)})()

    monkeypatch.setattr(chat_runs, 'async_session_factory', session)
    assert await chat_runs._conversation_images(conversation, owner) == [(run, 'photo.webp', 'photo.webp')]
    assert await chat_runs._conversation_images(other_conversation, owner) == []
    assert await chat_runs._conversation_images(conversation, other_owner) == []
