import io
import json
from uuid import uuid4

import httpx
import pytest
from docx import Document
from openpyxl import load_workbook
from pptx import Presentation
from pydantic import ValidationError

from app.services import agent, artifacts
from app.services.openrouter import WORKSPACE_MODEL, OpenRouterClient


@pytest.mark.asyncio
async def test_agent_executes_fragmented_calls_and_uses_results(monkeypatch):
    first, second = "return 2 + 2;", 'mae.writeFile("result.txt", "4"); return 4;'
    choice_count = call_count = 0
    run_id = uuid4()
    owner_id = uuid4()
    file = {"filename": "stored.txt", "display_name": "result.txt", "download_url": "/api/files/stored.txt"}

    class ModelClient:
        def __init__(self, key):
            self.closed = False

        async def decide_effort(self, messages):
            nonlocal choice_count
            choice_count += 1
            assert messages[-1]["content"] == "Compute and save 2 + 2"
            return "high"

        async def stream_deltas(self, model, history, tools, *, effort, allow_tools):
            assert model == WORKSPACE_MODEL and effort == "high" and allow_tools
            nonlocal call_count
            assert tools[0]["function"]["name"] == "execute_code"
            call_count += 1
            if call_count == 3:
                result = json.loads(history[-1]["content"])
                assert result == {"result": 4, "artifacts": [file]}
                assert history[-1]["tool_call_id"] == "call_2"
                yield {"content": "I saved the result."}
                return
            if call_count == 2:
                assert "interrupted" in json.loads(history[-1]["content"])["error"]
                assert history[-2]["reasoning"] == "private reasoning"
            arguments = json.dumps({"code": first if call_count == 1 else second})
            yield {"reasoning": "private "}
            yield {"reasoning_details": [{"type": "reasoning.text", "text": "reasoning"}]}
            yield {"tool_calls": [{
                "index": 0, "id": f"call_{call_count}",
                "function": {"name": "execute_code", "arguments": arguments[:10]},
            }]}
            yield {"tool_calls": [{"index": 0, "function": {"arguments": arguments[10:]}}]}

        async def complete(self, model, messages, **kwargs):
            evidence = json.loads(messages[-1]["content"])["tool_evidence"]
            assert evidence[-1]["result"]["artifacts"] == [file]
            return '{"status":"complete"}'

        async def close(self):
            self.closed = True

    def handle(request):
        assert request.url.path == "/execute"
        code = json.loads(request.content)["code"]
        if code == first:
            return httpx.Response(422, json={"detail": "Execution interrupted"})
        assert code == second
        return httpx.Response(200, json={
            "result": 4, "files": [{"name": "result.txt", "kind": "text", "text": "4"}],
        })

    async def save(owner, run, files, *, routine, image_files):
        assert (owner, run, routine) == (owner_id, run_id, True)
        assert files == [artifacts.TextFile(name="result.txt", kind="text", text="4")]
        return [file]

    model_client = ModelClient("unused")
    http_client = httpx.AsyncClient
    monkeypatch.setattr(agent, "OpenRouterClient", lambda _: model_client)
    monkeypatch.setattr(agent.httpx, "AsyncClient", lambda **opts: http_client(**opts, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(agent, "save_artifacts", save)

    events = [event async for event in agent.run_agent(
        [{"role": "user", "content": "Compute and save 2 + 2"}],
        "unused", owner_id, run_id, routine=True,
    )]
    assert [event["type"] for event in events] == ["progress", "progress", "artifact", "progress", "token"]
    assert events[-1]["text"] == "I saved the result."
    assert model_client.closed
    assert choice_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("status, choice, expected", [(200, "none", "none"), (200, "high", "high"), (200, "max", "low"), (503, "high", "low")])
async def test_effort_routing_requests_liquid_and_falls_back(status, choice, expected):
    def handle(request):
        body = json.loads(request.content)
        if request.url.path == "/api/alpha/decisions":
            assert body["model"] == "liquid/d1-ultra"
            assert "Current user request: Test task" in body["state"]
            assert set(body["questions"]["effort"]["criteria"]) == {"none", "low", "high"}
            return httpx.Response(status, json={"answers": {"effort": {"type": "choice", "choice": choice}}})
        assert request.url.path == "/api/v1/chat/completions"
        assert body["model"] == WORKSPACE_MODEL and body["reasoning"] == {"effort": expected}
        assert body["tools"] and body["tool_choice"] == "none"
        return httpx.Response(200, text='data: {"choices": [{"delta": {"content": "done"}}]}\n\ndata: [DONE]\n\n')

    client = OpenRouterClient("test")
    async with httpx.AsyncClient(base_url="https://openrouter.ai/api/v1", transport=httpx.MockTransport(handle)) as transport:
        client._client = transport
        messages = [{"role": "user", "content": "Test task"}]
        effort = await client.decide_effort(messages)
        assert effort == expected
        assert [delta async for delta in client.stream_deltas(WORKSPACE_MODEL, messages, agent.TOOLS, effort=effort, allow_tools=False)] == [{"content": "done"}]


def test_documents_are_native_and_spreadsheet_strings_do_not_become_formulas():
    section = artifacts.Section(heading="Summary", text="Quarterly notes")
    docx = artifacts.DocumentFile(name="report.docx", kind="document", title="Report", sections=[section])
    deck = artifacts.DocumentFile(name="report.pptx", kind="document", title="Report", sections=[section])
    xlsx = artifacts.SpreadsheetFile(name="sheet.xlsx", kind="spreadsheet", rows=[["=1+1", 6]])

    document = Document(io.BytesIO(artifacts._render(docx)))
    assert document.paragraphs[-1].text == "Quarterly notes"
    slides = Presentation(io.BytesIO(artifacts._render(deck))).slides
    assert slides[1].shapes.title.text == "Summary"
    cells = load_workbook(io.BytesIO(artifacts._render(xlsx))).active
    assert cells["A1"].value == "=1+1" and cells["A1"].data_type == "s"
    assert cells["B1"].value == 6


def test_artifacts_reject_paths_and_disguised_formats(tmp_path, monkeypatch):
    with pytest.raises(ValidationError):
        artifacts.TextFile(name="../secret.txt", kind="text", text="no")
    with pytest.raises(ValueError, match="filename extension"):
        artifacts._render(artifacts.TextFile(name="report.pdf", kind="text", text="not a pdf"))

    owner, run = uuid4(), uuid4()
    monkeypatch.setattr(artifacts.settings, "output_dir", str(tmp_path))
    outside = tmp_path / "outside"
    outside.mkdir()
    (tmp_path / str(owner)).symlink_to(outside)
    with pytest.raises(ValueError, match="storage path"):
        artifacts.artifact_path(owner, run, "file.txt")
