import json
from contextlib import asynccontextmanager

import httpx
import pytest

from app.adapters import Adapter, adapters, openapi, register_adapter
from app.connections import (
    AuthReference,
    ConnectionError,
    ConnectionSpec,
    RunInput,
    discover,
    execute,
    result_event,
    run_events,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def spec():
    return ConnectionSpec(
        name="API", kind="openapi", url="http://127.0.0.1/openapi.json"
    )


@pytest.fixture
def document():
    return {
        "openapi": "3.1.0",
        "info": {"title": "Fixture", "version": "1"},
        "paths": {
            "/inventory/{region}": {
                "get": {
                    "operationId": "inventory",
                    "parameters": [
                        {
                            "name": "region",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        },
                        {
                            "name": "limit",
                            "in": "query",
                            "schema": {"type": "integer", "minimum": 1},
                        },
                        {
                            "name": "tags",
                            "in": "query",
                            "schema": {"type": "array", "items": {"type": "string"}},
                        },
                        {
                            "name": "X-Trace",
                            "in": "header",
                            "schema": {"type": "string"},
                        },
                    ],
                    "responses": {"200": {"description": "OK"}},
                },
            },
            "/query": {
                "post": {
                    "operationId": "query",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/Query"}
                            }
                        },
                    },
                    "responses": {"200": {"description": "OK"}},
                }
            },
        },
        "components": {
            "schemas": {
                "Query": {
                    "type": "object",
                    "properties": {
                        "region": {"type": "string"},
                        "id": {"type": "integer", "readOnly": True},
                    },
                    "required": ["region", "id"],
                    "additionalProperties": False,
                }
            }
        },
    }


@pytest.fixture
def remote(monkeypatch, document):
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path == "/openapi.json":
            return httpx.Response(200, json=document)
        return httpx.Response(200, json={"rows": [{"region": "West", "value": 42}]})

    @asynccontextmanager
    async def client(*args):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            yield http

    monkeypatch.setattr(openapi, "http_client", client)
    return seen


async def test_discovery_only_fetches_document(spec, remote):
    found = await discover(spec, True, 10)
    assert len(remote) == 1
    assert remote[0].url.path == "/openapi.json"
    assert found["adapter"]["kind"] == "openapi"
    assert found["tools"][1]["requiresConfirmation"]
    schema = found["tools"][1]["inputSchema"]["properties"]["body"]
    assert schema["required"] == ["region"]
    assert "id" not in schema["properties"]


async def test_path_query_header_serialization(spec, remote):
    events = [
        event
        async for event in execute(
            spec,
            RunInput(
                tool="inventory",
                input={
                    "path": {"region": "North West"},
                    "query": {"limit": 3, "tags": ["one", "two"]},
                    "header": {"X-Trace": "trace"},
                },
            ),
            True,
            10,
        )
    ]
    request = remote[-1]
    assert request.url.raw_path.startswith(b"/inventory/North%20West?")
    assert request.url.params.get_list("tags") == ["one", "two"]
    assert request.url.params["limit"] == "3"
    assert request.headers["x-trace"] == "trace"
    assert events[0]["value"]["rows"][0]["value"] == 42


async def test_mutation_confirmation_and_schema_validation(spec, remote):
    for run, message in [
        (RunInput(tool="query", input={"body": {"region": "West"}}), "Confirm"),
        (RunInput(tool="query", confirmed=True, input={"body": {}}), "schema"),
    ]:
        with pytest.raises(ConnectionError, match=message):
            _ = [event async for event in execute(spec, run, True, 10)]
    assert all(request.url.path == "/openapi.json" for request in remote)
    _ = [
        event
        async for event in execute(
            spec,
            RunInput(tool="query", confirmed=True, input={"body": {"region": "West"}}),
            True,
            10,
        )
    ]
    assert remote[-1].method == "POST"
    assert remote[-1].content == b'{"region":"West"}'


async def test_a2ui_write_operation_requires_its_own_confirmation(
    spec, document, remote
):
    spec.config = {"a2ui_operation": "query"}
    document["paths"]["/query"]["post"]["requestBody"]["content"]["application/json"][
        "schema"
    ] = {
        "type": "object",
        "properties": {"messages": {"type": "array"}, "metadata": {"type": "object"}},
        "required": ["messages"],
    }
    message = {
        "version": "v1.0",
        "action": {
            "name": "save",
            "surfaceId": "surface",
            "sourceComponentId": "button",
            "timestamp": "2026-09-18T12:00:00Z",
            "context": {},
        },
    }
    run = RunInput(a2ui_messages=[message])
    with pytest.raises(ConnectionError, match="Confirm this operation"):
        _ = [event async for event in execute(spec, run, True, 10)]
    assert all(request.url.path == "/openapi.json" for request in remote)

    _ = [
        event
        async for event in execute(
            spec, run.model_copy(update={"confirmed": True}), True, 10
        )
    ]
    assert remote[-1].method == "POST"
    assert remote[-1].url.path == "/query"
    assert json.loads(remote[-1].content) == {"messages": [message], "metadata": {}}


@pytest.mark.parametrize(
    "change,reason",
    [
        (
            lambda doc: doc.update(servers=[{"url": "https://elsewhere.example"}]),
            "origin",
        ),
        (
            lambda doc: doc["paths"]["/query"]["post"]["requestBody"]["content"].update(
                {
                    "application/json": {
                        "schema": {"$ref": "https://evil.example/schema"}
                    }
                }
            ),
            "External",
        ),
        (
            lambda doc: doc["components"]["schemas"]["Query"].update(
                {"properties": {"self": {"$ref": "#/components/schemas/Query"}}}
            ),
            "Recursive",
        ),
        (
            lambda doc: doc["paths"]["/query"]["post"]["requestBody"].update(
                content={"multipart/form-data": {"schema": {}}}
            ),
            "JSON",
        ),
    ],
)
async def test_unsupported_operations_are_explained(spec, document, change, reason):
    change(document)
    found = openapi.operations(document, spec)
    entry = next(item for item in found if item["name"] in {"query", "/query"})
    assert not entry["available"]
    assert reason in entry["reason"]


async def test_duplicate_ids_cannot_execute_ambiguous_operation(spec, document):
    document["paths"]["/query"]["post"]["operationId"] = "inventory"
    assert all(not entry["available"] for entry in openapi.operations(document, spec))


async def test_nullable_30_and_parameter_styles():
    schema = openapi.resolve({"type": "string", "nullable": True}, {"openapi": "3.0.3"})
    assert schema["type"] == ["string", "null"]
    assert openapi.serialize_parameter(
        {"name": "filter", "in": "query", "style": "deepObject"}, {"region": "West"}
    ) == [("filter[region]", "West")]
    assert openapi.serialize_parameter(
        {"name": "ids", "in": "query", "style": "pipeDelimited", "explode": False},
        [1, 2],
    ) == [("ids", "1|2")]
    with pytest.raises(ConnectionError, match="Nested"):
        openapi.serialize_parameter(
            {"name": "filter", "in": "query", "style": "deepObject"},
            {"nested": {"a": 1}},
        )


async def test_trusted_custom_adapter_contract(monkeypatch):
    import app.adapters as registry

    monkeypatch.setattr(registry, "_registry", {})

    async def probe(*args):
        return {"verified": True}

    async def run(spec, request, *args):
        yield result_event({"custom": request.input})

    adapter = Adapter(
        "fixture.custom",
        "Custom",
        probe,
        run,
        config_schema={
            "type": "object",
            "properties": {"tenant": {"type": "string"}},
            "required": ["tenant"],
        },
    )
    register_adapter(adapter)
    assert "fixture.custom" in adapters()
    spec = ConnectionSpec(
        name="Custom",
        kind="fixture.custom",
        url="http://127.0.0.1",
        config={"tenant": "demo"},
    )
    assert (await discover(spec, True, 10))["adapter"]["contractVersion"] == "1.0"
    events = [
        event async for event in run_events(spec, RunInput(input={"x": 1}), True, 10)
    ]
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "CUSTOM",
        "RUN_FINISHED",
    ]
    with pytest.raises(ValueError, match="registered"):
        register_adapter(adapter)
    spec.config = {}
    with pytest.raises(ConnectionError, match="configuration"):
        await discover(spec, True, 10)
    spec.kind = "unknown"
    with pytest.raises(ConnectionError, match="not installed"):
        await discover(spec, True, 10)


async def test_response_schema_does_not_limit_request_execution(spec, document):
    document["paths"]["/inventory/{region}"]["get"]["responses"] = {
        "200": {
            "content": {
                "application/json": {
                    "schema": {"$ref": "https://example.com/arbitrary-response"}
                }
            }
        },
    }
    assert openapi.operations(document, spec)[0]["available"]


async def test_reserved_headers_and_auth_reference(spec, document):
    parameters = document["paths"]["/inventory/{region}"]["get"]["parameters"]
    parameters.append({"name": "Host", "in": "header", "schema": {"type": "string"}})
    assert not openapi.operations(document, spec)[0]["available"]
    parameters[-1] = {
        "name": "X-API-Key",
        "in": "header",
        "required": True,
        "schema": {"type": "string"},
    }
    spec.auth = AuthReference(env="TEST_KEY", header="X-API-Key")
    operation = openapi.operations(document, spec)[0]
    assert operation["available"]
    assert (
        "X-API-Key"
        not in operation["inputSchema"]["properties"]["header"]["properties"]
    )


async def test_unsupported_method_is_visible(spec, document):
    document["paths"]["/trace"] = {"trace": {"operationId": "trace"}}
    assert (
        openapi.operations(document, spec)[-1]["reason"]
        == "Unsupported HTTP method: TRACE"
    )


async def test_server_override_and_local_path_reference(spec, document):
    document["servers"] = [
        {"url": "https://{tenant}.example", "variables": {"tenant": {}}}
    ]
    spec.config = {"server_url": "/v2"}
    document["components"]["pathItems"] = {
        "Shared": document["paths"]["/inventory/{region}"]
    }
    document["paths"]["/inventory/{region}"] = {"$ref": "#/components/pathItems/Shared"}
    assert openapi.operations(document, spec)[0]["server"] == "http://127.0.0.1/v2"


async def test_malformed_adapter_discovery_is_rejected(monkeypatch):
    import app.adapters as registry

    monkeypatch.setattr(registry, "_registry", {})

    async def probe(*args):
        return {"verified": True, "tools": [{"name": "bad"}]}

    async def run(*args):
        yield result_event(None)

    register_adapter(
        Adapter("fixture.bad_schema", "Bad", probe, run, requires_endpoint=False)
    )
    with pytest.raises(ConnectionError, match="inputSchema"):
        await discover(ConnectionSpec(name="Bad", kind="fixture.bad_schema"), False, 10)


async def test_in_process_adapter_needs_no_endpoint(monkeypatch):
    import app.adapters as registry
    from examples.local_adapter import adapter

    monkeypatch.setattr(registry, "_registry", {})
    register_adapter(adapter)
    spec = ConnectionSpec(name="Local", kind="example.local")
    assert not (await discover(spec, False, 10))["adapter"]["requiresEndpoint"]
    events = [
        event
        async for event in run_events(
            spec, RunInput(tool="sum", input={"x": 2, "y": 3}), False, 10
        )
    ]
    assert events[1]["value"]["value"] == 5
    spec.kind = "http"
    with pytest.raises(ConnectionError, match="endpoint"):
        await discover(spec, False, 10)


async def test_invalid_custom_event_finishes_as_error(monkeypatch):
    import app.adapters as registry

    monkeypatch.setattr(registry, "_registry", {})

    async def probe(*args):
        return {"verified": False}

    async def run(*args):
        yield {"unknown": True}

    register_adapter(Adapter("fixture.broken", "Broken", probe, run))
    spec = ConnectionSpec(name="Bad", kind="fixture.broken", url="http://127.0.0.1")
    events = [event async for event in run_events(spec, RunInput(), True, 10)]
    assert events[-1]["type"] == "RUN_ERROR"
