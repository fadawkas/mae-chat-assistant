"""Run with MAE_TEST_CHAT_INTEGRATION=1 against disposable Postgres and Redis."""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from arq.connections import RedisSettings
from arq.worker import Worker
from sqlalchemy import delete, update

from app.api.routes import chat
from app.core import rate_limit
from app.core.auth import CSRF_COOKIE
from app.core.config import settings
from app.core.database import Base, async_session_factory, engine
from app.main import app
from app.models import Job, User
from app.services import chat_runs
from app.services.artifacts import TextFile, save_artifacts
from app.workers.queue import get_arq_redis

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("MAE_TEST_CHAT_INTEGRATION") != "1", reason="requires disposable Postgres and Redis"),
]


@pytest_asyncio.fixture
async def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "output_dir", str(tmp_path))
    monkeypatch.setattr(rate_limit, "_redis", None)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    email = f"{uuid4()}@example.org"
    credentials = {"email": email, "password": "temporary test password"}
    async with client() as browser:
        assert (await browser.post("/api/auth/signup", json={
            **credentials, "first_name": "Mae", "last_name": "Test",
        })).status_code == 201
        assert (await browser.put("/api/account/openrouter-key", json={"api_key": "test-model-key"},
                                  headers=csrf(browser))).status_code == 200
        create = await browser.post("/api/conversations", headers=csrf(browser))
        assert create.status_code == 201
        conversation = create.json()["id"]
    try:
        yield credentials, conversation
    finally:
        async with async_session_factory() as db:
            await db.execute(delete(User).where(User.email == email))
            await db.commit()
        await engine.dispose()
        if rate_limit._redis is not None:
            await rate_limit._redis.aclose()


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mae.test")


def csrf(browser):
    return {"X-CSRF-Token": browser.cookies[CSRF_COOKIE]}


async def sign_in(browser, credentials):
    assert (await browser.post("/api/auth/signin", json=credentials)).status_code == 200


async def submit(browser, conversation, run):
    return await browser.post("/api/chat", headers=csrf(browser), json={
        "conversation_id": conversation, "run_id": run, "content": "Create a test file",
    })


async def wait_for_run(browser, conversation, condition):
    async with asyncio.timeout(6):
        while True:
            result = await browser.get(f"/api/chat/{conversation}")
            assert result.status_code == 200
            if condition(result.json()):
                return result.json()
            await asyncio.sleep(0.1)


def make_worker():
    return Worker([chat_runs.chat_job], burst=True, handle_signals=False, poll_delay=0.05,
                  redis_settings=RedisSettings.from_dsn(settings.redis_url))


async def test_run_survives_client_close_and_replays_exactly_one_artifact(workspace, monkeypatch):
    credentials, conversation = workspace
    release = asyncio.Event()
    calls = 0

    async def agent(messages, api_key, owner, run, **kwargs):
        nonlocal calls
        calls += 1
        assert messages == [{"role": "user", "content": "Create a test file"}]
        yield {"type": "progress", "message": "Preparing file"}
        yield {"type": "token", "text": "Working. "}
        await release.wait()
        await save_artifacts(owner, run, [TextFile(name="result.txt", kind="text", text="verified")], routine=False)
        yield {"type": "token", "text": "File saved."}

    monkeypatch.setattr(chat_runs, "run_agent", agent)
    run = str(uuid4())
    worker = make_worker()
    try:
        async with client() as browser:
            await sign_in(browser, credentials)
            assert (await submit(browser, conversation, run)).status_code == 202
            assert (await submit(browser, conversation, run)).status_code == 202
            assert (await submit(browser, conversation, str(uuid4()))).status_code == 409
            task = asyncio.create_task(worker.async_run())
            partial = await wait_for_run(browser, conversation, lambda data: data["content"] == "Working. ")
            assert partial["status"] == "in_progress" and partial["progress"] == "Preparing file"
            assert (await browser.delete(f"/api/conversations/{conversation}", headers=csrf(browser))).status_code == 409
            async with client() as outsider:
                assert (await outsider.post("/api/auth/signup", json={
                    "email": f"{uuid4()}@example.org", "password": "temporary test password",
                    "first_name": "Other", "last_name": "User",
                })).status_code == 201
                assert (await outsider.get(f"/api/chat/{conversation}")).status_code == 404
                assert (await outsider.post(f"/api/chat/{run}/stop", headers=csrf(outsider))).status_code == 404
        # No client is connected while the worker saves the result.
        release.set()
        await asyncio.wait_for(task, 6)
        await chat_runs.chat_job({}, run)  # duplicate queue delivery is a no-op
        async with client() as reopened:
            await sign_in(reopened, credentials)
            result = await wait_for_run(reopened, conversation, lambda data: data["status"] == "done")
            history = (await reopened.get(f"/api/conversations/{conversation}")).json()["messages"]
            assert [message["role"] for message in history] == ["user", "assistant"]
            assert result["content"] == history[-1]["content"] == "Working. File saved."
            assert result["artifacts"] == history[-1]["artifacts"]
            artifact, = result["artifacts"]
            assert (await reopened.get(artifact["download_url"])).text == "verified"
        assert calls == 1
    finally:
        release.set()
        await worker.close()


async def test_reconcile_and_stop_without_replaying_effects(workspace, monkeypatch):
    credentials, conversation = workspace

    async def offline():
        raise ConnectionError("Redis unavailable during submission")

    monkeypatch.setattr(chat, "get_arq_redis", offline)
    cancelled = asyncio.Event()

    async def agent(*args, **kwargs):
        try:
            yield {"type": "token", "text": "Partial work"}
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(chat_runs, "run_agent", agent)
    redis = await get_arq_redis()
    worker = make_worker()
    try:
        async with client() as browser:
            await sign_in(browser, credentials)
            run = str(uuid4())
            assert (await submit(browser, conversation, run)).status_code == 202
            async with async_session_factory() as db:
                await db.execute(update(Job).where(Job.id == UUID(run)).values(
                    created_at=datetime.now(timezone.utc) - timedelta(seconds=3),
                ))
                await db.commit()
            await chat_runs.reconcile_chat_runs({"redis": redis})
            task = asyncio.create_task(worker.async_run())
            await wait_for_run(browser, conversation, lambda data: data["content"] == "Partial work")
            assert (await browser.post(f"/api/chat/{run}/stop", headers=csrf(browser))).status_code == 204
            await asyncio.wait_for(cancelled.wait(), 6)
            await asyncio.wait_for(task, 6)
            stopped = await wait_for_run(browser, conversation, lambda data: data["status"] == "cancelled")
            assert stopped["content"] == "Partial work"

            stranded = str(uuid4())
            assert (await submit(browser, conversation, stranded)).status_code == 202
            async with async_session_factory() as db:
                await db.execute(update(Job).where(Job.id == UUID(stranded)).values(
                    status="in_progress", updated_at=datetime.now(timezone.utc) - timedelta(minutes=5),
                    result={"content": "Before the crash"},
                ))
                await db.commit()
            await chat_runs.reconcile_chat_runs({"redis": redis})
            interrupted = await wait_for_run(browser, conversation, lambda data: data["status"] == "interrupted")
            assert interrupted["content"] == "Before the crash"
            assert not await redis.zscore("arq:queue", f"chat:{stranded}")
    finally:
        await worker.close()
        await redis.aclose()


async def test_browser_grant_is_one_upload_revocable_and_requires_user_choice(workspace, monkeypatch):
    credentials, conversation = workspace
    run = str(uuid4())
    received = asyncio.Event()
    stopped = asyncio.Event()
    table = {"url": "https://example.org/inventory?secret=never-sent#hidden", "title": "Inventory",
             "rows": [["Item", "Count"], ["Apples", "12"]]}

    async def agent(*args, browser_observation, **kwargs):
        assert browser_observation == {"source": "https://example.org/inventory", "title": "Inventory", "rows": table["rows"]}
        received.set()
        try:
            await asyncio.Event().wait()
            yield {}
        finally:
            stopped.set()

    monkeypatch.setattr(chat_runs, "run_agent", agent)
    worker = make_worker()
    try:
        async with client() as browser, client() as helper:
            await sign_in(browser, credentials)
            assert (await browser.post("/api/chat", headers=csrf(browser), json={
                "conversation_id": conversation, "run_id": run,
                "content": "Export this table to a spreadsheet", "use_browser_tab": True,
            })).status_code == 202
            assert (await helper.put(f"/api/browser-grants/{run}", json=table)).status_code == 404
            grant = await browser.post(f"/api/chat/{run}/browser-grant", headers=csrf(browser))
            assert grant.status_code == 200
            headers = {"Authorization": "Bearer " + grant.json()["code"]}
            task = asyncio.create_task(worker.async_run())
            assert (await helper.put(f"/api/browser-grants/{run}", headers=headers, json=table)).status_code == 204
            assert (await helper.put(f"/api/browser-grants/{run}", headers=headers, json=table)).status_code == 409
            await asyncio.wait_for(received.wait(), 6)
            assert (await helper.delete(f"/api/browser-grants/{run}", headers=headers)).status_code == 204
            await asyncio.wait_for(stopped.wait(), 6)
            await asyncio.wait_for(task, 6)
            run_data = await wait_for_run(browser, conversation, lambda data: data["status"] == "incomplete")
            assert "revoked" in run_data["error"]
            assert not run_data["artifacts"]
            assert (await helper.put(f"/api/browser-grants/{run}", headers=headers, json=table)).status_code == 404
            async with async_session_factory() as db:
                job = await db.get(Job, UUID(run))
                assert "browser_observation" not in job.payload and "browser_secret" not in job.payload
    finally:
        await worker.close()


async def test_offline_browser_does_not_start_model_work(workspace, monkeypatch):
    credentials, conversation = workspace
    monkeypatch.setattr(chat_runs, "BROWSER_WAIT_TIMEOUT", 0.15)
    worker = make_worker()
    try:
        async with client() as browser:
            await sign_in(browser, credentials)
            run = str(uuid4())
            assert (await browser.post("/api/chat", headers=csrf(browser), json={
                "conversation_id": conversation, "run_id": run,
                "content": "Read the selected table", "use_browser_tab": True,
            })).status_code == 202
            await asyncio.wait_for(worker.async_run(), 6)
            run_data = await wait_for_run(browser, conversation, lambda data: data["status"] == "incomplete")
            assert "offline" in run_data["error"]
            assert run_data["content"] == "" and not run_data["artifacts"]
    finally:
        await worker.close()

