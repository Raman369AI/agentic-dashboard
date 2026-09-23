import json

import pytest
from a2a.types import Part
from ag_ui.core import RunAgentInput
from google.protobuf.json_format import MessageToDict, ParseDict

from app.a2ui import BASIC_CATALOG, MIME_TYPE, render_a2ui_v1, validate_messages
from app.a2ui_adk import register_agent_function
from app.connections import RunInput, map_request
from app.server import agui_agent

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


def test_wire_validation_strict_envelopes_and_unicode_extensions():
    valid = json.loads(json.dumps(ACTION))
    valid["action"]["metadata"] = {"extensions": {"日本語": {"ok": True}}}
    validate_messages([valid], "renderer_to_agent")
    valid["action"]["metadata"]["extensions"]["bad-key"] = True
    with pytest.raises(ValueError):
        validate_messages([valid], "renderer_to_agent")
    with pytest.raises(ValueError):
        RunInput(a2ui_messages=[{"version": "v0.9", "action": {}}])
    with pytest.raises(ValueError):
        RunInput(a2ui_messages=[{**ACTION, "deleteSurface": {"surfaceId": "s"}}])


def test_adk_render_tool_uses_pinned_schema_and_reports_invalid_payloads():
    message = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s",
            "catalogId": BASIC_CATALOG["catalogId"],
            "components": [{"id": "root", "component": "Text", "text": "Hello"}],
        },
    }
    assert render_a2ui_v1(json.dumps([message])) == {"a2ui_messages": [message]}
    message["createSurface"]["components"][0]["unsupported"] = True
    assert render_a2ui_v1(json.dumps([message]))["status"] == "error"
    assert render_a2ui_v1("{}")["status"] == "error"


def test_typed_http_and_a2a_binding_preserves_arrays_and_metadata():
    run = RunInput(
        a2ui_messages=[ACTION],
        metadata={
            "a2uiRendererCapabilities": {
                "v1.0": {"supportedCatalogIds": [BASIC_CATALOG["catalogId"]]}
            }
        },
    )
    assert map_request({"events": "$a2uiMessages", "meta": "$metadata"}, run) == {
        "events": [ACTION],
        "meta": run.metadata,
    }
    part = ParseDict(
        {"data": run.a2ui_messages, "metadata": {"mimeType": MIME_TYPE}}, Part()
    )
    assert MessageToDict(part)["data"] == [ACTION]


@pytest.mark.asyncio
async def test_adk_rpc_return_channel_does_not_need_model_calls():
    register_agent_function(
        "https://example.com/test", "double", lambda value: value * 2
    )

    def request(name):
        return RunAgentInput(
            thread_id="fixture",
            run_id=name,
            messages=[],
            state={},
            tools=[],
            context=[],
            forwarded_props={
                "a2uiMessages": [
                    {
                        "version": "v1.0",
                        "callAgentFunction": {
                            "surfaceId": "s",
                            "functionCallId": name,
                            "callFunction": {
                                "catalogId": "https://example.com/test",
                                "call": name,
                                "args": {"value": 5},
                            },
                        },
                    }
                ]
            },
        )

    events = [
        event.model_dump(by_alias=True)
        async for event in agui_agent.run(request("double"))
    ]
    assert events[1]["value"][0]["agentFunctionResponse"] == {
        "functionCallId": "double",
        "value": 10,
    }
    events = [
        event.model_dump(by_alias=True)
        async for event in agui_agent.run(request("missing"))
    ]
    assert (
        events[1]["value"][0]["agentFunctionResponse"]["error"]["code"]
        == "UNKNOWN_FUNCTION"
    )
