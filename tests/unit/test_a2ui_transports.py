import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from google.protobuf.json_format import MessageToDict

import app.connections as connections
from app.a2ui import BASIC_CATALOG, EXTENSION_URI
from app.connections import ConnectionSpec, RunInput, execute, run_events

pytestmark = pytest.mark.asyncio
ACTION = {
    "version": "v1.0",
    "action": {
        "name": "save",
        "surfaceId": "s",
        "sourceComponentId": "b",
        "timestamp": "2026-09-18T12:00:00Z",
        "context": {"name": "Ada"},
    },
}
META = {
    "a2uiRendererCapabilities": {
        "v1.0": {"supportedCatalogIds": [BASIC_CATALOG["catalogId"]]}
    }
}


async def test_http_a2ui_bypasses_query_schema_and_requires_explicit_mapping(
    monkeypatch,
):
    seen = []

    @asynccontextmanager
    async def client(*args):
        def handle(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200, json={"a2ui_messages": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            yield http

    monkeypatch.setattr(connections, "http_client", client)
    spec = ConnectionSpec(
        name="form",
        kind="http",
        url="http://127.0.0.1/form",
        http={
            "input_schema": {"type": "object", "required": ["query"]},
            "body": {"messages": "$a2uiMessages", "metadata": "$metadata"},
        },
    )
    run = RunInput(a2ui_messages=[ACTION], metadata=META)
    events = [event async for event in execute(spec, run, True, 10)]
    assert events[0]["value"] == {"a2ui_messages": []}
    assert seen == [{"messages": [ACTION], "metadata": META}]
    spec.http.body = {"prompt": "$prompt"}
    events = [event async for event in run_events(spec, run, True, 10)]
    assert events[-1]["type"] == "RUN_ERROR"
    assert "$a2uiMessages" in events[-1]["message"]
    assert len(seen) == 1


async def test_agui_forwarded_props_are_structured_without_fake_chat(monkeypatch):
    seen = []

    @asynccontextmanager
    async def client(*args):
        def handle(request):
            seen.append(json.loads(request.content))
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text='data: {"type":"RUN_FINISHED"}\n\n',
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            yield http

    monkeypatch.setattr(connections, "http_client", client)
    spec = ConnectionSpec(name="form", kind="agui", url="http://127.0.0.1/form")
    _ = [
        event
        async for event in execute(
            spec, RunInput(a2ui_messages=[ACTION], metadata=META), True, 10
        )
    ]
    assert seen[0]["forwardedProps"] == {"a2uiMessages": [ACTION], "metadata": META}
    assert not any(
        "UI action:" in message.get("content", "") for message in seen[0]["messages"]
    )


async def test_mcp_uses_explicit_return_tool_and_request_meta(monkeypatch):
    seen = []

    class Remote:
        async def list_tools(self, cursor=None):
            return SimpleNamespace(
                tools=[
                    SimpleNamespace(
                        name="handle_a2ui",
                        input_schema={
                            "type": "object",
                            "properties": {"messages": {"type": "array"}},
                            "required": ["messages"],
                        },
                    )
                ],
                next_cursor=None,
            )

        async def call_tool(self, name, arguments, *, meta):
            seen.append((name, arguments, meta))
            return SimpleNamespace(
                is_error=False,
                model_dump=lambda **kwargs: {
                    "structuredContent": {"a2ui_messages": []}
                },
            )

    @asynccontextmanager
    async def client(*args):
        yield Remote()

    monkeypatch.setattr(connections, "mcp_client", client)
    spec = ConnectionSpec(
        name="form", kind="mcp", url="http://127.0.0.1/mcp", a2ui_tool="handle_a2ui"
    )
    _ = [
        event
        async for event in execute(
            spec, RunInput(a2ui_messages=[ACTION], metadata=META), True, 10
        )
    ]
    assert seen == [("handle_a2ui", {"messages": [ACTION]}, META)]
    spec.a2ui_tool = None
    events = [
        event
        async for event in run_events(spec, RunInput(a2ui_messages=[ACTION]), True, 10)
    ]
    assert events[-1]["type"] == "RUN_ERROR"
    assert "a2ui_tool" in events[-1]["message"]


async def test_a2a_sends_native_data_parts_and_extension_metadata(monkeypatch):
    seen = []

    @asynccontextmanager
    async def client(*args):
        async with httpx.AsyncClient() as http:
            yield http

    class Resolver:
        def __init__(self, client, url):
            assert client.headers["A2A-Extensions"] == EXTENSION_URI

        async def get_agent_card(self):
            return object()

    class Remote:
        async def send_message(self, request):
            seen.append(MessageToDict(request.message))
            yield request.message

    class Factory:
        def __init__(self, config):
            pass

        def create(self, card):
            return Remote()

    monkeypatch.setattr(connections, "http_client", client)
    monkeypatch.setattr(connections, "A2ACardResolver", Resolver)
    monkeypatch.setattr(connections, "ClientFactory", Factory)
    spec = ConnectionSpec(name="form", kind="a2a", url="http://127.0.0.1/agent")
    _ = [
        event
        async for event in execute(
            spec,
            RunInput(
                thread_id="context",
                task_id="task",
                a2ui_messages=[ACTION],
                metadata=META,
            ),
            True,
            10,
        )
    ]
    assert seen[0]["taskId"] == "task"
    assert seen[0]["contextId"] == "context"
    assert seen[0]["metadata"] == META
    assert seen[0]["extensions"] == [EXTENSION_URI]
    assert seen[0]["parts"] == [
        {
            "data": [ACTION],
            "metadata": {"mimeType": "application/a2ui+json"},
            "mediaType": "application/a2ui+json",
        }
    ]
