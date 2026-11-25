import json
from uuid import uuid4

import httpx
import pytest

from app.services import agent
from app.services.openrouter import OpenRouterClient, TruncatedResponse


def code_call(index, source):
    return {"tool_calls": [{"index": 0, "id": f"call-{index}", "function": {
        "name": "execute_code", "arguments": json.dumps({"code": source}),
    }}]}


@pytest.mark.asyncio
async def test_early_completion_is_rejected_and_truncation_does_not_replay_saved_effects(monkeypatch):
    calls = []
    rounds = 0
    reviews = 0
    file = {"filename": "receipt.txt", "display_name": "receipt.txt"}

    class Model:
        async def decide_effort(self, messages):
            return "low"

        async def close(self):
            pass

        async def stream_deltas(self, model, history, tools, **kwargs):
            nonlocal rounds
            rounds += 1
            if rounds == 1:
                yield {"content": "I saved receipt.txt, without doing any work."}
            elif rounds == 2:
                assert "Completion check found unfinished work" in history[0]["content"]
                yield code_call(rounds, "save receipt")
            elif rounds == 3:
                yield code_call(rounds, "discard this truncated call")
                raise TruncatedResponse()
            elif rounds == 4:
                yield code_call(rounds, "save receipt")
            else:
                assert json.loads(history[-1]["content"])["reused"] is True
                yield {"content": "Saved receipt.txt."}

        async def complete(self, model, messages, **kwargs):
            nonlocal reviews
            reviews += 1
            data = json.loads(messages[-1]["content"])
            if not data["tool_evidence"]:
                return '{"status":"retry","remaining":"The receipt file was not saved."}'
            assert data["tool_evidence"] == [{"tool": "execute_code", "result": {"artifacts": [file]}}]
            return '{"status":"complete"}'

    async def execute(runner, call, *args, **kwargs):
        calls.append(json.loads(call["function"]["arguments"])["code"])
        return {"artifacts": [file]}, [file]

    monkeypatch.setattr(agent, "OpenRouterClient", lambda _: Model())
    monkeypatch.setattr(agent, "_execute", execute)
    events = [event async for event in agent.run_agent(
        [{"role": "user", "content": "Create a receipt file"}], "test", uuid4(), uuid4(),
    )]
    assert calls == ["save receipt"] and reviews == 2
    assert [event["text"] for event in events if event["type"] == "token"] == ["Saved receipt.txt."]
    assert [event["artifact"] for event in events if event["type"] == "artifact"] == [file]


@pytest.mark.asyncio
async def test_model_cannot_claim_a_browser_spreadsheet_without_a_saved_workbook(monkeypatch):
    class Model:
        async def decide_effort(self, messages):
            return "none"

        async def close(self):
            pass

        async def stream_deltas(self, *args, **kwargs):
            yield {"content": "I saved everything."}

        async def complete(self, *args, **kwargs):
            return '{"status":"complete"}'

    monkeypatch.setattr(agent, "OpenRouterClient", lambda _: Model())
    events = []
    with pytest.raises(agent.AgentIncomplete, match="spreadsheet was not saved"):
        async for event in agent.run_agent([{"role": "user", "content": "Export this table to a spreadsheet"}],
                                            "test", uuid4(), uuid4(), browser_observation={"rows": [["Count"], ["10"]]}):
            events.append(event)
    assert all(event["type"] != "token" for event in events)


@pytest.mark.asyncio
async def test_provider_reports_early_eof_and_length():
    for output in (
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    ):
        client = OpenRouterClient("test")
        client._client = httpx.AsyncClient(base_url="https://example.test", transport=httpx.MockTransport(
            lambda _: httpx.Response(200, text=output)))
        try:
            with pytest.raises(TruncatedResponse):
                async for _ in client.stream_deltas("test", []):
                    pass
        finally:
            await client.close()


@pytest.mark.asyncio
async def test_simple_chat_returns_without_a_second_model_request(monkeypatch):
    class Model:
        async def decide_effort(self, messages):
            return "none"

        async def close(self):
            pass

        async def stream_deltas(self, *args, **kwargs):
            yield {"content": "Hello!"}

        async def complete(self, *args, **kwargs):
            pytest.fail("Simple greetings must not request a completion review")

    monkeypatch.setattr(agent, "OpenRouterClient", lambda _: Model())
    assert [event async for event in agent.run_agent(
        [{"role": "user", "content": "Hello"}], "test", uuid4(), uuid4(),
    )] == [{"type": "token", "text": "Hello!"}]

