import json
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from mcp import Client
from mcp.server import MCPServer
from pydantic import ValidationError

import app.connections as connections
from app.connections import (
    ConnectionSpec,
    ConnectionStore,
    RunInput,
    discover,
    execute,
    run_events,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def mocked_http(monkeypatch):
    seen = []

    def install(handler):
        @asynccontextmanager
        async def client(spec, allow_private, timeout):
            async def dispatch(request):
                seen.append(request)
                return handler(request)

            async with httpx.AsyncClient(
                transport=httpx.MockTransport(dispatch)
            ) as http:
                yield http

        monkeypatch.setattr(connections, "http_client", client)
        return seen

    return install


async def test_http_mapping_preserves_typed_input_and_extracts_result(mocked_http):
    seen = mocked_http(
        lambda request: httpx.Response(
            200, json={"answer": [{"region": "West", "revenue": 10}]}
        )
    )
    spec = ConnectionSpec(
        name="semantic",
        kind="http",
        url="http://127.0.0.1/query",
        http={
            "body": {"query": "$input", "question": "$prompt"},
            "response_path": "/answer",
        },
    )
    events = [
        event
        async for event in execute(
            spec, RunInput(prompt="Revenue", input={"region": "West"}), True, 10
        )
    ]
    assert json.loads(seen[0].content) == {
        "query": {"region": "West"},
        "question": "Revenue",
    }
    assert events[0]["value"] == [{"region": "West", "revenue": 10}]


async def test_sse_multiline_crlf_and_final_frame(mocked_http):
    mocked_http(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=': heartbeat\r\ndata: {"type":"CUSTOM",\r\ndata: "value":{"ok":true}}\r\n\r\ndata: {"type":"RUN_FINISHED"}',
        )
    )
    spec = ConnectionSpec(name="agent", kind="agui", url="http://127.0.0.1/run")
    events = [event async for event in execute(spec, RunInput(prompt="Hi"), True, 10)]
    assert events == [
        {"type": "CUSTOM", "value": {"ok": True}},
        {"type": "RUN_FINISHED"},
    ]


async def test_failed_runs_never_emit_success_or_leak_upstream_body(mocked_http):
    mocked_http(lambda request: httpx.Response(401, text="secret-upstream-diagnostic"))
    spec = ConnectionSpec(name="agent", kind="http", url="http://127.0.0.1/run")
    events = [
        event async for event in run_events(spec, RunInput(prompt="Hi"), True, 10)
    ]
    assert [event["type"] for event in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert "secret-upstream" not in json.dumps(events)
    assert "401" in events[-1]["message"]


async def test_private_urls_rechecked_on_every_run():
    spec = ConnectionSpec(name="private", kind="http", url="http://127.0.0.1/run")
    events = [event async for event in run_events(spec, RunInput(), False, 10)]
    assert events[-1]["type"] == "RUN_ERROR"
    assert "Private-network" in events[-1]["message"]


async def test_auth_references_are_persisted_but_values_never_are(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("FIXTURE_TOKEN", "never-persist-this")
    spec = ConnectionSpec(
        name="secret",
        kind="http",
        url="http://127.0.0.1/run",
        auth={"env": "FIXTURE_TOKEN"},
    )
    store = ConnectionStore(tmp_path / "registry.db")
    result = store.save(spec, {"verified": False})
    assert "never-persist-this" not in json.dumps(store.all())
    assert connections.auth_headers(spec) == {
        "Authorization": "Bearer never-persist-this"
    }
    assert result["auth"]["env"] == "FIXTURE_TOKEN"
    assert store.delete(result["id"])


async def test_auth_never_follows_agent_card_to_other_origin(monkeypatch):
    monkeypatch.setenv("FIXTURE_TOKEN", "test-only")
    spec = ConnectionSpec(
        name="secret",
        kind="a2a",
        url="http://127.0.0.1:9001",
        auth={"env": "FIXTURE_TOKEN"},
    )
    with pytest.raises(connections.ConnectionError, match="registered origin"):
        await connections.request_guard(spec, True)(
            httpx.Request("POST", "http://127.0.0.1:9002")
        )


async def test_mcp_discovery_validation_and_structured_results(monkeypatch):
    server = MCPServer("fixture")
    calls = []

    @server.tool(structured_output=True)
    def query_revenue(region: str) -> dict[str, Any]:
        calls.append(region)
        return {"rows": [{"region": region, "revenue": 100}]}

    @asynccontextmanager
    async def client(spec, allow_private, timeout):
        async with Client(server) as remote:
            yield remote

    monkeypatch.setattr(connections, "mcp_client", client)
    spec = ConnectionSpec(name="semantic", kind="mcp", url="http://127.0.0.1/mcp")
    discovered = await discover(spec, True, 10)
    assert discovered["tools"][0]["name"] == "query_revenue"
    assert discovered["tools"][0]["inputSchema"]["required"] == ["region"]
    result = [
        event
        async for event in execute(
            spec, RunInput(tool="query_revenue", input={"region": "West"}), True, 10
        )
    ]
    assert result[0]["value"]["structuredContent"]["rows"][0]["revenue"] == 100
    invalid = [
        event
        async for event in run_events(
            spec, RunInput(tool="query_revenue", input={}), True, 10
        )
    ]
    assert invalid[-1]["type"] == "RUN_ERROR"
    assert calls == ["West"]


async def test_mapping_path_and_schema_errors_are_explicit(mocked_http):
    mocked_http(lambda request: httpx.Response(200, json={"rows": []}))
    spec = ConnectionSpec(
        name="bad mapping",
        kind="http",
        url="http://127.0.0.1/query",
        http={"response_path": "/missing"},
    )
    events = [event async for event in run_events(spec, RunInput(), True, 10)]
    assert "Response does not contain" in events[-1]["message"]


async def test_manifest_rejects_inline_url_credentials():
    with pytest.raises(ValidationError):
        ConnectionSpec(
            name="bad", kind="http", url="https://example.com?api_key=secret"
        )


async def test_nested_get_query_is_encoded_as_json(mocked_http):
    seen = mocked_http(lambda request: httpx.Response(200, json={"data": []}))
    spec = ConnectionSpec(
        name="semantic",
        kind="http",
        url="http://127.0.0.1/load",
        http={"method": "GET", "body": {"query": "$input"}},
    )
    query = {"measures": ["Orders.count"], "dimensions": ["Orders.region"]}
    _ = [event async for event in execute(spec, RunInput(input=query), True, 10)]
    assert json.loads(seen[0].url.params["query"]) == query


async def test_legacy_migration_is_non_destructive_and_does_not_undo_deletes(tmp_path):
    from app.domain.registry import AgentRegistry

    path = tmp_path / "registry.db"
    legacy = AgentRegistry(path)
    record = legacy.save("https://example.com", {"name": "Existing agent"})
    store = ConnectionStore(path)
    assert store.get(record.id)["name"] == "Existing agent"
    store.update_discovery(record.id, {"verified": True})
    assert ConnectionStore(path).get(record.id)["discovery"]["verified"] is True
    assert store.delete(record.id)
    assert ConnectionStore(path).all() == []
    assert legacy.get(record.id) is not None


async def test_truncated_agui_stream_is_not_reported_successful(mocked_http):
    mocked_http(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text='data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Partial"}\n\n',
        )
    )
    spec = ConnectionSpec(name="stream", kind="agui", url="http://127.0.0.1/run")
    events = [event async for event in run_events(spec, RunInput(), True, 10)]
    assert events[-1]["type"] == "RUN_ERROR"
    assert not any(event["type"] == "RUN_FINISHED" for event in events)


async def test_mcp_tool_error_marks_run_failed(monkeypatch):
    server = MCPServer("error-fixture")

    @server.tool()
    def fail_query() -> str:
        raise ValueError("Fixture tool failure")

    @asynccontextmanager
    async def client(spec, allow_private, timeout):
        async with Client(server) as remote:
            yield remote

    monkeypatch.setattr(connections, "mcp_client", client)
    spec = ConnectionSpec(name="tools", kind="mcp", url="http://127.0.0.1/mcp")
    events = [
        event async for event in run_events(spec, RunInput(tool="fail_query"), True, 10)
    ]
    assert events[-1]["type"] == "RUN_ERROR"
    assert not any(event["type"] == "RUN_FINISHED" for event in events)


async def test_a2a_failed_task_status_is_not_success():
    assert connections.a2a_failure(
        {"statusUpdate": {"status": {"state": "TASK_STATE_FAILED"}}}
    )
    assert connections.a2a_failure(
        {"task": {"status": {"state": "TASK_STATE_REJECTED"}}}
    )
    assert (
        connections.a2a_failure({"status": {"state": "TASK_STATE_COMPLETED"}}) is None
    )
