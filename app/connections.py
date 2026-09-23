"""Runtime connection manifests and protocol adapters, independent of ADK."""

from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import sqlite3
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
import httpx2
from a2a.client import ClientConfig, ClientFactory
from a2a.client.card_resolver import A2ACardResolver
from a2a.types import Message, Part, SendMessageRequest
from google.protobuf.json_format import MessageToDict, ParseDict
from jsonschema import Draft202012Validator
from mcp import Client as MCPClient
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.a2ui import EXTENSION_URI, MIME_TYPE, validate_messages
from app.domain.registry import RegistryError, validate_remote_url

MAX_BYTES = 8 * 1024 * 1024


class ConnectionError(ValueError):
    """A connection error safe to display to a user."""


class AuthReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    env: str = Field(pattern=r"^[A-Z][A-Z0-9_]*$")
    header: str = Field(default="Authorization", pattern=r"^[A-Za-z][A-Za-z0-9-]*$")
    prefix: str = Field(default="Bearer ", max_length=50)

    @field_validator("header")
    @classmethod
    def allowed_header(cls, value: str) -> str:
        if value.lower() in {
            "host",
            "content-length",
            "connection",
            "transfer-encoding",
        }:
            raise ValueError("This header cannot be used for credentials.")
        return value

    @field_validator("prefix")
    @classmethod
    def no_newlines(cls, value: str) -> str:
        if "\r" in value or "\n" in value:
            raise ValueError("Credential prefix must be one line.")
        return value


class HttpMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["GET", "POST"] = "POST"
    body: dict[str, Any] = Field(default_factory=lambda: {"prompt": "$prompt"})
    response_path: str = ""
    input_schema: dict[str, Any] = Field(default_factory=lambda: {"type": "object"})

    @field_validator("input_schema")
    @classmethod
    def valid_schema(cls, value: dict) -> dict:
        Draft202012Validator.check_schema(value)
        return value


class ConnectionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(pattern=r"^[a-z][a-z0-9_.-]{0,63}$")
    config: dict[str, Any] = Field(default_factory=dict)
    url: str = Field(default="", max_length=2048)
    description: str = Field(default="", max_length=2000)
    auth: AuthReference | None = None
    a2ui_tool: str | None = Field(default=None, max_length=200)
    http: HttpMapping = Field(default_factory=HttpMapping)

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        if not value:
            return value
        parts = urlsplit(value)
        if parts.scheme not in {"https", "http"} or not parts.hostname:
            raise ValueError("Use a complete http:// or https:// URL.")
        if parts.username or parts.password or parts.fragment:
            raise ValueError("URLs cannot contain credentials or fragments.")
        # Auth belongs in environment references, never a persisted URL.
        if re.search(r"(token|api.?key|secret|password|signature)=", parts.query, re.I):
            raise ValueError(
                "Use an auth environment reference instead of a secret in the URL."
            )
        return value


class RunInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(default="", max_length=50_000)
    thread_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=200)
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    input: dict[str, Any] = Field(default_factory=dict)
    tool: str | None = Field(default=None, max_length=200)
    state: dict[str, Any] = Field(default_factory=dict)
    a2ui_messages: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    metadata: dict[str, Any] = Field(default_factory=dict)
    task_id: str = Field(default="", max_length=200)
    confirmed: bool = False

    @field_validator("a2ui_messages")
    @classmethod
    def valid_a2ui_messages(cls, value: list[dict]) -> list[dict]:
        validate_messages(value, "renderer_to_agent")
        return value


class ConnectionStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY, spec TEXT NOT NULL, discovery TEXT NOT NULL
            )""")
            # Import existing registrations once, without changing the legacy table.
            db.execute(
                "CREATE TABLE IF NOT EXISTS migrated_legacy (id TEXT PRIMARY KEY)"
            )
            if db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agents'"
            ).fetchone():
                rows = db.execute(
                    "SELECT id,name,description,base_url,card_json FROM agents WHERE id NOT IN (SELECT id FROM migrated_legacy)"
                ).fetchall()
                for connection_id, name, description, url, card in rows:
                    try:
                        spec = ConnectionSpec(
                            name=name, description=description, url=url, kind="a2a"
                        )
                        discovery = {"card": json.loads(card), "verified": False}
                    except (ValueError, TypeError):
                        continue
                    db.execute(
                        "INSERT OR IGNORE INTO connections VALUES (?,?,?)",
                        (connection_id, spec.model_dump_json(), json.dumps(discovery)),
                    )
                    db.execute(
                        "INSERT INTO migrated_legacy VALUES (?)", (connection_id,)
                    )

    def all(self) -> list[dict]:
        with sqlite3.connect(self.path) as db:
            return [
                self._record(row)
                for row in db.execute(
                    "SELECT id,spec,discovery FROM connections ORDER BY rowid DESC"
                )
            ]

    @staticmethod
    def _record(row) -> dict:
        return {"id": row[0], **json.loads(row[1]), "discovery": json.loads(row[2])}

    def get(self, connection_id: str) -> dict | None:
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT id,spec,discovery FROM connections WHERE id=?", (connection_id,)
            ).fetchone()
        return self._record(row) if row else None

    def save(self, spec: ConnectionSpec, discovery: dict) -> dict:
        connection_id = str(uuid.uuid4())
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT INTO connections VALUES (?,?,?)",
                (connection_id, spec.model_dump_json(), json.dumps(discovery)),
            )
        return self.get(connection_id)  # type: ignore[return-value]

    def update_discovery(self, connection_id: str, discovery: dict) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "UPDATE connections SET discovery=? WHERE id=?",
                (json.dumps(discovery), connection_id),
            )

    def delete(self, connection_id: str) -> bool:
        with sqlite3.connect(self.path) as db:
            return (
                db.execute(
                    "DELETE FROM connections WHERE id=?", (connection_id,)
                ).rowcount
                > 0
            )


def spec_from_record(record: dict) -> ConnectionSpec:
    return ConnectionSpec.model_validate(
        {k: v for k, v in record.items() if k not in {"id", "discovery"}}
    )


def auth_headers(spec: ConnectionSpec) -> dict[str, str]:
    if spec.auth is None:
        return {}
    value = os.getenv(spec.auth.env)
    if not value:
        raise ConnectionError(
            f"Set {spec.auth.env} in the API process environment, then retry."
        )
    return {spec.auth.header: spec.auth.prefix + value}


def origin(url: str) -> tuple:
    parsed = urlsplit(url)
    return (
        parsed.scheme,
        parsed.hostname,
        parsed.port or (443 if parsed.scheme == "https" else 80),
    )


def request_guard(spec: ConnectionSpec, allow_private: bool):
    async def guard(request):
        await validate_remote_url(str(request.url), allow_private)
        if spec.auth and origin(str(request.url)) != origin(spec.url):
            # Cards may advertise endpoints on another host. Never send credentials there.
            raise ConnectionError(
                "Authenticated connections must use the registered origin for every endpoint."
            )

    return guard


@asynccontextmanager
async def http_client(spec: ConnectionSpec, allow_private: bool, timeout: float):
    async with httpx.AsyncClient(
        headers=auth_headers(spec),
        timeout=timeout,
        follow_redirects=False,
        event_hooks={"request": [request_guard(spec, allow_private)]},
    ) as client:
        yield client


@asynccontextmanager
async def mcp_client(spec: ConnectionSpec, allow_private: bool, timeout: float):
    async with httpx2.AsyncClient(
        headers=auth_headers(spec),
        timeout=timeout,
        follow_redirects=False,
        event_hooks={"request": [request_guard(spec, allow_private)]},
    ) as http:
        async with MCPClient(
            streamable_http_client(spec.url, http_client=http),
            read_timeout_seconds=timeout,
        ) as client:
            yield client


async def discover(spec: ConnectionSpec, allow_private: bool, timeout: float) -> dict:
    from app.adapters import get_adapter, validate_config

    adapter = get_adapter(spec.kind)
    validate_config(adapter, spec.config)
    if adapter.requires_endpoint and not spec.url:
        raise ConnectionError("This adapter requires an endpoint URL.")
    if spec.url:
        await validate_remote_url(spec.url, allow_private)
    auth_headers(spec)
    result = await adapter.discover(spec, allow_private, timeout)
    if not isinstance(result, dict) or not isinstance(result.get("verified"), bool):
        raise ConnectionError("Adapter discovery must return a verified boolean.")
    tools = result.get("tools", [])
    if not isinstance(tools, list) or len(tools) > 1000:
        raise ConnectionError("Adapter discovery must return at most 1000 operations.")
    for operation in tools:
        if (
            not isinstance(operation, dict)
            or not isinstance(operation.get("name"), str)
            or not isinstance(operation.get("inputSchema"), dict)
        ):
            raise ConnectionError(
                "Adapter operations need a name and inputSchema object."
            )
    if len(json.dumps(result, allow_nan=False).encode()) > MAX_BYTES:
        raise ConnectionError("Adapter discovery exceeds the 8 MiB limit.")
    return {**result, "adapter": adapter.descriptor()}


async def _discover_builtin(
    spec: ConnectionSpec, allow_private: bool, timeout: float
) -> dict:
    await validate_remote_url(spec.url, allow_private)
    auth_headers(spec)
    if spec.kind == "a2a":
        async with http_client(spec, allow_private, timeout) as client:
            card = await A2ACardResolver(client, spec.url).get_agent_card()
            for interface in card.supported_interfaces:
                await validate_remote_url(interface.url, allow_private)
                if spec.auth and origin(interface.url) != origin(spec.url):
                    raise ConnectionError(
                        "Authenticated Agent Card endpoints must use the registered origin."
                    )
            return {"verified": True, "card": MessageToDict(card)}
    if spec.kind == "mcp":
        async with mcp_client(spec, allow_private, timeout) as client:
            tools = []
            cursor = None
            for _ in range(100):
                result = await client.list_tools(cursor=cursor)
                tools.extend(
                    tool.model_dump(mode="json", by_alias=True, exclude_none=True)
                    for tool in result.tools
                )
                cursor = result.next_cursor
                if not cursor:
                    break
            else:
                raise ConnectionError("Tool discovery exceeded 100 pages.")
            return {
                "verified": True,
                "tools": tools,
                "protocolVersion": client.protocol_version,
            }
    # Do not invoke arbitrary HTTP endpoints just to register them.
    return {
        "verified": False,
        "note": "Configuration saved. Verify with a run; registration does not invoke this endpoint.",
    }


def map_request(value: Any, run: RunInput) -> Any:
    replacements = {
        "$prompt": run.prompt,
        "$input": run.input,
        "$messages": run.messages,
        "$threadId": run.thread_id,
        "$a2uiMessages": run.a2ui_messages,
        "$metadata": run.metadata,
    }
    if isinstance(value, str):
        return copy.deepcopy(replacements.get(value, value))
    if isinstance(value, dict):
        return {key: map_request(child, run) for key, child in value.items()}
    if isinstance(value, list):
        return [map_request(child, run) for child in value]
    return value


def select_path(value: Any, path: str) -> Any:
    if not path:
        return value
    if not path.startswith("/"):
        raise ConnectionError(
            "response_path must be an RFC 6901 JSON pointer, for example /data/rows."
        )
    try:
        for key in path.split("/")[1:]:
            key = key.replace("~1", "/").replace("~0", "~")
            value = value[int(key)] if isinstance(value, list) else value[key]
        return value
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise ConnectionError(
            f"Response does not contain configured path {path}."
        ) from error


def result_event(value: Any) -> dict:
    if len(json.dumps(value).encode()) > MAX_BYTES:
        raise ConnectionError("Result exceeds the 8 MiB display limit.")
    return {"type": "CUSTOM", "name": "relay.result", "value": value}


async def sse_json(response: httpx.Response) -> AsyncIterator[dict]:
    data: list[str] = []
    total = 0
    async for line in response.aiter_lines():
        total += len(line.encode())
        if total > MAX_BYTES:
            raise ConnectionError("Stream exceeds the 8 MiB limit.")
        if line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
        elif not line and data:
            raw = "\n".join(data)
            data = []
            if raw == "[DONE]":
                return
            yield json.loads(raw)
    if data and "\n".join(data) != "[DONE]":
        yield json.loads("\n".join(data))


async def execute(
    spec: ConnectionSpec, run: RunInput, allow_private: bool, timeout: float
) -> AsyncIterator[dict]:
    from app.adapters import get_adapter, validate_config

    adapter = get_adapter(spec.kind)
    validate_config(adapter, spec.config)
    if adapter.requires_endpoint and not spec.url:
        raise ConnectionError("This adapter requires an endpoint URL.")
    if spec.url:
        await validate_remote_url(spec.url, allow_private)
    auth_headers(spec)
    async for event in adapter.execute(spec, run, allow_private, timeout):
        if not isinstance(event, dict) or not isinstance(event.get("type"), str):
            raise ConnectionError(
                "Adapter returned an invalid event. Use result_event for ordinary values."
            )
        if len(json.dumps(event, allow_nan=False).encode()) > MAX_BYTES:
            raise ConnectionError("Adapter event exceeds the 8 MiB limit.")
        yield event


async def _execute_builtin(
    spec: ConnectionSpec, run: RunInput, allow_private: bool, timeout: float
) -> AsyncIterator[dict]:
    """Yield native AG-UI events or CUSTOM result events from any supported adapter."""
    await validate_remote_url(spec.url, allow_private)
    if spec.kind == "mcp":
        if run.a2ui_messages:
            if not spec.a2ui_tool:
                raise ConnectionError(
                    "Configure a2ui_tool for this MCP service to receive UI messages."
                )
            run = run.model_copy(
                update={
                    "tool": spec.a2ui_tool,
                    "input": {"messages": run.a2ui_messages},
                }
            )
        if not run.tool:
            raise ConnectionError("Select an MCP tool and provide its input arguments.")
        async with mcp_client(spec, allow_private, timeout) as client:
            # Resolve the selected tool against the live server, including pagination.
            cursor = None
            tool = None
            for _ in range(100):
                page = await client.list_tools(cursor=cursor)
                tool = next(
                    (item for item in page.tools if item.name == run.tool), None
                )
                cursor = page.next_cursor
                if tool or not cursor:
                    break
            if tool is None:
                raise ConnectionError(
                    "Selected tool is no longer available. Refresh discovery."
                )
            errors = list(
                Draft202012Validator(tool.input_schema).iter_errors(run.input)
            )
            if errors:
                raise ConnectionError(
                    "Tool arguments do not match its input schema: " + errors[0].message
                )
            result = await client.call_tool(run.tool, run.input, meta=run.metadata)
            yield result_event(
                result.model_dump(mode="json", by_alias=True, exclude_none=True)
            )
            if result.is_error:
                yield {
                    "type": "RUN_ERROR",
                    "message": "The MCP tool reported an error. See its returned result.",
                }
        return

    async with http_client(spec, allow_private, timeout) as client:
        if spec.kind == "a2a":
            client.headers["A2A-Extensions"] = EXTENSION_URI
            card = await A2ACardResolver(client, spec.url).get_agent_card()
            remote = ClientFactory(
                ClientConfig(
                    httpx_client=client,
                    streaming=True,
                    supported_protocol_bindings=["JSONRPC", "HTTP+JSON"],
                )
            ).create(card)
            parts = [Part(text=run.prompt)] if run.prompt else []
            if run.a2ui_messages:
                parts.append(
                    ParseDict(
                        {
                            "data": run.a2ui_messages,
                            "metadata": {"mimeType": MIME_TYPE},
                            "mediaType": MIME_TYPE,
                        },
                        Part(),
                    )
                )
            message = ParseDict(
                {
                    "role": "ROLE_USER",
                    "messageId": str(uuid.uuid4()),
                    "contextId": run.thread_id,
                    "taskId": run.task_id,
                    "metadata": run.metadata,
                    "extensions": [EXTENSION_URI],
                },
                Message(),
            )
            message.parts.extend(parts)
            async for event in remote.send_message(SendMessageRequest(message=message)):
                if isinstance(event, tuple):
                    task, update = event
                    # Emit the update, not a repeated cumulative task + update pair.
                    payload = MessageToDict(update if update is not None else task)
                else:
                    payload = MessageToDict(event)
                yield result_event(payload)
                failure = a2a_failure(payload)
                if failure:
                    yield {"type": "RUN_ERROR", "message": failure}
            return

        if spec.kind == "agui":
            payload = {
                "threadId": run.thread_id,
                "runId": str(uuid.uuid4()),
                "messages": run.messages
                or (
                    []
                    if run.a2ui_messages
                    else [
                        {"id": str(uuid.uuid4()), "role": "user", "content": run.prompt}
                    ]
                ),
                "state": run.state,
                "context": [],
                "tools": [],
                "forwardedProps": {
                    "a2uiMessages": run.a2ui_messages,
                    "metadata": run.metadata,
                },
            }
            async with client.stream(
                "POST", spec.url, json=payload, headers={"Accept": "text/event-stream"}
            ) as response:
                response.raise_for_status()
                if "text/event-stream" not in response.headers.get("content-type", ""):
                    raise ConnectionError(
                        "Expected an SSE stream from the AG-UI endpoint."
                    )
                async for event in sse_json(response):
                    yield event
            return

        if run.a2ui_messages and "$a2uiMessages" not in json.dumps(spec.http.body):
            raise ConnectionError(
                "HTTP return channel requires a $a2uiMessages request mapping."
            )
        errors = list(
            Draft202012Validator(spec.http.input_schema).iter_errors(run.input)
            if not run.a2ui_messages
            else []
        )
        if errors:
            raise ConnectionError(
                "Input does not match the configured schema: " + errors[0].message
            )
        payload = map_request(spec.http.body, run)
        params = {
            key: json.dumps(value) if isinstance(value, (dict, list)) else value
            for key, value in payload.items()
        }
        kwargs = {"params": params} if spec.http.method == "GET" else {"json": payload}
        async with client.stream(spec.http.method, spec.url, **kwargs) as response:
            response.raise_for_status()
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw.extend(chunk)
                if len(raw) > MAX_BYTES:
                    raise ConnectionError("HTTP response exceeds the 8 MiB limit.")
            try:
                value = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                value = raw.decode("utf-8", errors="replace")
            yield result_event(select_path(value, spec.http.response_path))


def a2a_failure(payload: dict) -> str | None:
    update = payload.get("statusUpdate", payload.get("task", payload))
    state = update.get("status", {}).get("state", "")
    if state in {
        "TASK_STATE_FAILED",
        "TASK_STATE_REJECTED",
        "TASK_STATE_CANCELED",
        "failed",
        "rejected",
        "canceled",
    }:
        return f"Remote A2A task ended with state {state}."
    return None


def public_error(error: Exception) -> str:
    # Never include upstream URLs, response bodies, or request headers in errors.
    if isinstance(error, (ConnectionError, RegistryError)):
        return str(error)
    if isinstance(error, (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException)):
        return "The service timed out. Check availability or AGENT_TIMEOUT_SECONDS."
    if isinstance(error, httpx.HTTPStatusError):
        return f"The service returned HTTP {error.response.status_code}."
    return f"Connection failed ({type(error).__name__}). Check the service URL, credentials, and protocol."


async def run_events(
    spec: ConnectionSpec, run: RunInput, allow_private: bool, timeout: float
) -> AsyncIterator[dict]:
    import anyio

    run_id = str(uuid.uuid4())
    failed = False
    terminal = False
    yield {"type": "RUN_STARTED", "threadId": run.thread_id, "runId": run_id}
    try:
        with anyio.fail_after(timeout):
            async for event in execute(spec, run, allow_private, timeout):
                if event.get("type") == "RUN_FINISHED":
                    terminal = True
                    continue
                if event.get("type") == "RUN_STARTED":
                    continue
                if event.get("type") == "RUN_ERROR":
                    failed = True
                yield event
            from app.adapters import get_adapter

            if (
                get_adapter(spec.kind).requires_terminal_event
                and not terminal
                and not failed
            ):
                raise ConnectionError("The adapter stream ended before RUN_FINISHED.")
    except asyncio.CancelledError:
        raise
    except Exception as error:
        failed = True
        yield {"type": "RUN_ERROR", "message": public_error(error)}
    if not failed:
        yield {"type": "RUN_FINISHED", "threadId": run.thread_id, "runId": run_id}
