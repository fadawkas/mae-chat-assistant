import asyncio
import base64
import io
import json
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.services import agent, artifacts
from app.services.openrouter import IMAGE_MODEL, OpenRouterClient


def png():
    buffer = io.BytesIO()
    Image.new('RGB', (4, 4), 'red').save(buffer, 'PNG')
    return buffer.getvalue()


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [None, 'base64', 'svg', 402, 429, 502])
async def test_image_provider_response(monkeypatch, failure):
    data = png()
    calls = 0
    saved = []

    def handle(request):
        nonlocal calls
        calls += 1
        assert request.url.path == '/api/v1/images'
        assert request.headers['authorization'] == 'Bearer test'
        assert json.loads(request.content) == {
            'model': IMAGE_MODEL, 'prompt': 'A red panda', 'aspect_ratio': '16:9',
            'n': 1, 'response_format': 'b64_json',
        }
        if isinstance(failure, int):
            return httpx.Response(failure, json={'private_provider_detail': 'not for users'})
        return httpx.Response(200, json={'data': [{
            'b64_json': '***' if failure == 'base64' else base64.b64encode(data).decode(),
            'media_type': 'image/svg+xml' if failure == 'svg' else 'image/png',
        }]})

    async def save(owner, run, received, mime, *, title):
        assert artifacts.validate_image(received, mime) == 'png'
        assert title == 'Red Panda'
        saved.append(received)
        return {'filename': 'saved.png'}

    monkeypatch.setattr(agent, 'save_image', save)
    client = OpenRouterClient('test')
    async with httpx.AsyncClient(base_url='https://openrouter.ai/api/v1', headers={'Authorization': 'Bearer test'}, transport=httpx.MockTransport(handle)) as transport:
        client._client = transport
        artifact, error = await agent._generate_image(
            client, 'A red panda', '16:9', uuid4(), uuid4(), asyncio.Lock(), 'Red Panda',
        )
    assert calls == 1
    if failure is None:
        assert artifact == {'filename': 'saved.png'} and error is None and saved == [data]
    else:
        assert not saved and artifact is None
        assert error and 'private_provider_detail' not in error
        if failure in (402, 429):
            assert ('credits' if failure == 402 else 'rate limiting') in error


@pytest.mark.asyncio
@pytest.mark.parametrize('prompt,choice,routine,expected', [
    ('Draw a red panda', 'one', False, 1),
    ('Draw five photos of red pandas', 'five', False, 5),
    ('Write an image prompt for a red panda', 'other', False, 0),
    ('Explain the previous request', 'other', False, 0),
    ('Draw a red panda', None, False, 0),
    ('Draw a red panda', 'one', True, 0),
])
async def test_image_tool_checks_latest_message_and_caps_calls(monkeypatch, prompt, choice, routine, expected):
    rounds = 0
    generated = []
    gates = 0
    prompts = [f'Red panda scene {index}' for index in range(1, 6)]
    titles = ['Forest Panda', 'Forest-Panda', 'Panda in Rain', 'Sleeping Panda', 'Panda at Dusk']
    images = [{'prompt': prompt, 'title': title} for prompt, title in zip(prompts, titles)]
    partial_failure = expected == 5

    async def stream(self, model, history, tools, **options):
        nonlocal rounds
        assert any(tool['function']['name'] == 'generate_image' for tool in tools) is not routine
        rounds += 1
        if rounds == 1:
            for index in range(2):
                yield {'tool_calls': [{
                    'index': index, 'id': f'call_{index}',
                    'function': {'name': 'generate_image', 'arguments': json.dumps({'images': images})},
                }]}
        else:
            assert 'already attempted' in json.loads(history[-1]['content'])['error']
            if partial_failure:
                result = json.loads(history[-2]['content'])
                assert result['attempted'] == 5
                assert result['errors'][0]['image'] == 3
                assert [file['display_name'] for file in result['artifacts']] == [
                    'Forest Panda', 'Forest-Panda 2', 'Sleeping Panda', 'Panda at Dusk',
                ]
            yield {'content': 'Done.'}

    def route(request):
        nonlocal gates
        body = json.loads(request.content)
        if request.url.path == '/api/v1/chat/completions':
            return httpx.Response(200, json={'choices': [{'message': {'content': '{"status":"complete"}'}}]})
        assert request.url.path == '/api/alpha/decisions'
        if 'effort' in body['questions']:
            return httpx.Response(200, json={'answers': {'effort': {'type': 'choice', 'choice': 'low'}}})
        gates += 1
        assert body['state'] == prompt
        if choice is None:
            return httpx.Response(503)
        return httpx.Response(200, json={'answers': {'intent': {'type': 'choice', 'choice': choice}}})

    async def generate(self, image_prompt, ratio):
        generated.append(image_prompt)
        assert ratio == '1:1'
        if partial_failure and image_prompt == prompts[2]:
            raise httpx.ReadTimeout('test timeout')
        return png(), 'image/png'

    async def save(*args, title):
        return {'filename': artifacts.download_filename(title, 'png'), 'display_name': title}

    client = OpenRouterClient('test')
    client._client = httpx.AsyncClient(base_url='https://openrouter.ai/api/v1', transport=httpx.MockTransport(route))
    monkeypatch.setattr(agent, 'OpenRouterClient', lambda _: client)
    monkeypatch.setattr(OpenRouterClient, 'stream_deltas', stream)
    monkeypatch.setattr(OpenRouterClient, 'generate_image', generate)
    monkeypatch.setattr(agent, 'save_image', save)
    events = []
    try:
        async for event in agent.run_agent([
            {'role': 'user', 'content': 'Create an image of a cat'},
            {'role': 'user', 'content': prompt},
        ], 'test', uuid4(), uuid4(), routine=routine):
            events.append(event)
    except agent.AgentIncomplete:
        assert partial_failure
    assert generated == prompts[:expected] and gates == (0 if routine else 1)
    saved = expected - int(partial_failure)
    assert sum(event['type'] == 'artifact' for event in events) == saved
    assert (events[-1]['type'] == 'token') is not partial_failure
    if partial_failure:
        assert events[0]['message'] == 'Generating 5 images…'


@pytest.mark.asyncio
@pytest.mark.parametrize('recovers', [True, False])
async def test_image_to_deck_retries_text_tool_markup_without_showing_or_executing_it(monkeypatch, recovers):
    image = {'filename': 'trail.png', 'display_name': 'Wooded Trail'}
    deck = {'filename': 'trail.pptx', 'display_name': 'Trail Pilot.pptx'}
    turns = 0
    executed = []

    def call(name, arguments):
        return {'tool_calls': [{'index': 0, 'id': f'call_{turns}', 'function': {
            'name': name, 'arguments': json.dumps(arguments),
        }}]}

    class Client:
        async def decide_effort(self, messages):
            return 'low'

        async def requested_image_count(self, prompt):
            return 1

        async def close(self):
            pass

        async def complete(self, model, messages, **kwargs):
            return '{"status":"complete"}'

        async def stream_deltas(self, model, history, tools, **options):
            nonlocal turns
            turns += 1
            if turns == 1:
                yield call('generate_image', {'images': [{'title': 'Wooded Trail', 'prompt': 'A forest trail'}]})
            elif turns == 2 or (turns == 3 and not recovers):
                yield {'content': 'Image saved. <'}
                yield {'content': ' | DS' if turns == 2 else '｜DS'}
                yield {'content': 'ML | calls>' if turns == 2 else 'ML｜calls>'}
                yield {'content': 'print("PRIVATE TOOL BODY")</｜DSML｜calls>'}
            elif turns == 3:
                assert json.loads(history[-1]['content'])['artifacts'] == [image]
                assert all('PRIVATE TOOL BODY' not in (msg.get('content') or '') for msg in history)
                yield call('execute_code', {'code': 'mae.document("trail.pptx", "Trail Pilot", [], {cover_image: "trail.png"});'})
            else:
                yield {'content': 'PowerPoint saved. 2 <'}
                yield {'content': ' 3.'}

    async def generate(*args):
        return image, None

    async def execute(runner, call, owner_id, run_id, *, routine, files_left, image_files):
        executed.append(json.loads(call['function']['arguments'])['code'])
        assert 'trail.png' in image_files
        return {'artifacts': [deck]}, [deck]

    monkeypatch.setattr(agent, 'OpenRouterClient', lambda _: Client())
    monkeypatch.setattr(agent, '_generate_image', generate)
    monkeypatch.setattr(agent, '_execute', execute)
    events = []
    try:
        async for event in agent.run_agent(
            [{'role': 'user', 'content': 'Generate a photo and use it in a PowerPoint.'}], 'test', uuid4(), uuid4(),
        ):
            events.append(event)
    except agent.AgentIncomplete as exc:
        assert not recovers
        assert 'already saved' in str(exc)
    shown = ''.join(event['text'] for event in events if event['type'] == 'token')
    assert 'DSML' not in shown and 'PRIVATE TOOL BODY' not in shown
    assert [event['artifact'] for event in events if event['type'] == 'artifact'] == ([image, deck] if recovers else [image])
    assert len(executed) == int(recovers)
    assert turns == (4 if recovers else 3)
    assert shown == ('PowerPoint saved. 2 < 3.' if recovers else '')


def test_image_validation_rejects_disguised_mime():
    with pytest.raises(ValueError, match='Invalid image data'):
        artifacts.validate_image(png(), 'image/webp')
