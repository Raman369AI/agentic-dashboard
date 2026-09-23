"""Explicit A2UI v1 bridge; independent of ag-ui-adk's older injection helper."""

from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import Callable
from typing import Any

from ag_ui.core import (
    CustomEvent,
    RunAgentInput,
    RunFinishedEvent,
    RunStartedEvent,
    UserMessage,
)
from ag_ui_adk import ADKAgent

from app.a2ui import validate_messages

_agent_functions: dict[tuple[str, str], Callable[..., Any]] = {}


def register_agent_function(
    catalog_id: str, name: str, function: Callable[..., Any]
) -> None:
    """Register trusted server code at startup. Never import code from a UI payload."""
    _agent_functions[(catalog_id, name)] = function


class A2UIADKAgent(ADKAgent):
    async def run(self, input: RunAgentInput):
        props = input.forwarded_props if isinstance(input.forwarded_props, dict) else {}
        messages = props.get("a2uiMessages", [])
        if not isinstance(messages, list):
            raise ValueError("a2uiMessages must be an array.")
        validate_messages(messages, "renderer_to_agent")
        actions = []
        replies = []
        for message in messages:
            if "callAgentFunction" in message:
                call = message["callAgentFunction"]
                function = call["callFunction"]
                handler = _agent_functions.get(
                    (function.get("catalogId", ""), function["call"])
                )
                response = {"functionCallId": call["functionCallId"]}
                if handler is None:
                    response["error"] = {
                        "code": "UNKNOWN_FUNCTION",
                        "message": "No agent implementation is registered.",
                    }
                else:
                    try:
                        value = handler(**function.get("args", {}))
                        if inspect.isawaitable(value):
                            value = await value
                        response["value"] = value
                    except Exception:
                        response["error"] = {
                            "code": "EXECUTION_FAILED",
                            "message": "The agent function failed.",
                        }
                reply = {"version": "v1.0", "agentFunctionResponse": response}
                validate_messages([reply], "agent_to_renderer")
                replies.append(reply)
            elif "action" in message or "rendererFunctionResponse" in message:
                actions.append(message)
            # Error reports terminate here, preventing renderer/agent error loops.
        if messages and not actions:
            yield RunStartedEvent(
                type="RUN_STARTED", thread_id=input.thread_id, run_id=input.run_id
            )
            if replies:
                yield CustomEvent(type="CUSTOM", name="a2ui", value=replies)
            yield RunFinishedEvent(
                type="RUN_FINISHED", thread_id=input.thread_id, run_id=input.run_id
            )
            return
        state = dict(input.state or {})
        state["a2ui_metadata"] = props.get("metadata", {})
        state["a2ui_messages"] = actions
        changes: dict[str, Any] = {
            "state": state,
            "forwarded_props": {**props, "injectA2UITool": False},
        }
        if actions:
            # Structured protocol has already been validated/handled. This is the
            # ADK model's JSON representation, not a fabricated chat action.
            changes["messages"] = [
                UserMessage(
                    id=str(uuid.uuid4()),
                    role="user",
                    content=json.dumps(
                        {"a2ui_messages": actions, "metadata": state["a2ui_metadata"]}
                    ),
                )
            ]
        async for event in super().run(input.model_copy(update=changes)):
            yield event
            if event.type == "RUN_STARTED" and replies:
                yield CustomEvent(type="CUSTOM", name="a2ui", value=replies)
                replies = []
