"""Deterministic v1 form agent used by browser tests and integration tutorials."""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.a2ui import BASIC_CATALOG, validate_messages

router = APIRouter()


def form_messages(messages: list[dict], metadata: dict) -> list[dict]:
    supported = metadata["a2uiRendererCapabilities"]["v1.0"]["supportedCatalogIds"]
    assert BASIC_CATALOG["catalogId"] in supported
    validate_messages(messages, "renderer_to_agent")
    if not messages:
        return [
            {
                "version": "v1.0",
                "createSurface": {
                    "surfaceId": "fixture-form",
                    "catalogId": BASIC_CATALOG["catalogId"],
                    "sendDataModel": True,
                    "dataModel": {
                        "name": "",
                        "status": "Not submitted",
                        "items": [
                            {"title": "Dynamic row one"},
                            {"title": "Dynamic row two"},
                        ],
                    },
                    "components": [
                        {
                            "id": "root",
                            "component": "Column",
                            "children": [
                                "title",
                                "name",
                                "list",
                                "remote",
                                "save",
                                "status",
                                "clear",
                            ],
                        },
                        {"id": "title", "component": "Text", "text": "# A2UI v1 form"},
                        {
                            "id": "name",
                            "component": "TextField",
                            "label": "Your name",
                            "value": {"path": "/name"},
                        },
                        {
                            "id": "list",
                            "component": "List",
                            "children": {"path": "/items", "componentId": "item"},
                        },
                        {"id": "item", "component": "Text", "text": {"path": "title"}},
                        {
                            "id": "remote",
                            "component": "Text",
                            "text": {
                                "call": "remoteGreeting",
                                "args": {"name": {"path": "/name"}},
                            },
                        },
                        {
                            "id": "save",
                            "component": "Button",
                            "child": "saveLabel",
                            "checks": [
                                {
                                    "condition": {
                                        "call": "required",
                                        "args": {"value": {"path": "/name"}},
                                    }
                                },
                                {
                                    "condition": {
                                        "call": "regex",
                                        "args": {
                                            "value": {"path": "/name"},
                                            "pattern": "^[A-Za-z ]+$",
                                        },
                                    }
                                },
                            ],
                            "action": {
                                "event": {
                                    "name": "save",
                                    "context": {"name": {"path": "/name"}},
                                }
                            },
                        },
                        {"id": "saveLabel", "component": "Text", "text": "Submit form"},
                        {
                            "id": "status",
                            "component": "Text",
                            "text": {"path": "/status"},
                            "accessibility": {"live": "polite"},
                        },
                        {
                            "id": "clear",
                            "component": "Button",
                            "child": "clearLabel",
                            "action": {"event": {"name": "clear"}},
                        },
                        {
                            "id": "clearLabel",
                            "component": "Text",
                            "text": "Delete surface",
                        },
                    ],
                },
            }
        ]
    result = []
    for message in messages:
        if "callAgentFunction" in message:
            call = message["callAgentFunction"]
            assert call["callFunction"]["call"] == "remoteGreeting"
            name = call["callFunction"]["args"]["name"]
            result.append(
                {
                    "version": "v1.0",
                    "agentFunctionResponse": {
                        "functionCallId": call["functionCallId"],
                        "value": "Hello " + (name or "visitor"),
                    },
                }
            )
        elif "action" in message:
            action = message["action"]
            assert action["surfaceId"] == "fixture-form"
            if action["name"] == "clear":
                result.append(
                    {"version": "v1.0", "deleteSurface": {"surfaceId": "fixture-form"}}
                )
            else:
                name = action["context"]["name"]
                assert (
                    metadata["a2uiRendererDataModel"]["surfaces"]["fixture-form"][
                        "name"
                    ]
                    == name
                )
                result.append(
                    {
                        "version": "v1.0",
                        "updateDataModel": {
                            "surfaceId": "fixture-form",
                            "path": "/status",
                            "value": "Saved " + name,
                        },
                    }
                )
    validate_messages(result, "agent_to_renderer")
    return result


@router.post("/a2ui/http")
async def http_form(body: dict):
    return {
        "a2ui_messages": form_messages(
            body.get("messages", []), body.get("metadata", {})
        )
    }


@router.post("/a2ui/ag-ui")
async def agui_form(body: dict):
    props = body.get("forwardedProps", {})
    messages = form_messages(props.get("a2uiMessages", []), props.get("metadata", {}))

    async def events():
        for payload in [
            {
                "type": "RUN_STARTED",
                "threadId": body["threadId"],
                "runId": body["runId"],
            },
            {"type": "CUSTOM", "name": "a2ui", "value": messages},
            {
                "type": "RUN_FINISHED",
                "threadId": body["threadId"],
                "runId": body["runId"],
            },
        ]:
            yield "data: " + json.dumps(payload) + "\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
