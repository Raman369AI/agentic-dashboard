"""OpenAPI JSON operation discovery/execution. No generated or downloaded code."""

from __future__ import annotations

import base64
import json
import re
from urllib.parse import quote, urljoin, urlsplit

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from app.connections import (
    MAX_BYTES,
    ConnectionError,
    http_client,
    origin,
    result_event,
    select_path,
)

METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
BLOCKED_HEADERS = {
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "authorization",
    "cookie",
    "proxy-authorization",
}
BAD_KEYS = {"__proto__", "constructor", "prototype"}


async def read_body(response):
    data = bytearray()
    async for chunk in response.aiter_bytes():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise ConnectionError("OpenAPI document/response exceeds the 8 MiB limit.")
    return bytes(data)


async def document(client, spec):
    async with client.stream("GET", spec.url) as response:
        response.raise_for_status()
        try:
            doc = json.loads(await read_body(response))
        except (ValueError, UnicodeDecodeError) as error:
            raise ConnectionError("Provide an OpenAPI JSON document URL.") from error
    if not isinstance(doc, dict) or not str(doc.get("openapi", "")).startswith(
        ("3.0.", "3.1.", "3.2.")
    ):
        raise ConnectionError("Expected an OpenAPI 3.0, 3.1 or 3.2 JSON document.")
    return doc


def resolve(value, doc, trail=(), budget=None):
    """Expand only local refs, with cycle/depth/size guards and no network resolver."""
    if budget is None:
        budget = [0]
    budget[0] += 1
    if budget[0] > 20000 or len(trail) > 64:
        raise ConnectionError("OpenAPI schema is too large or deeply nested.")
    if isinstance(value, list):
        return [resolve(item, doc, (*trail, "[]"), budget) for item in value]
    if not isinstance(value, dict):
        return value
    if BAD_KEYS.intersection(value):
        raise ConnectionError("Unsafe OpenAPI object key.")
    if "$dynamicRef" in value:
        raise ConnectionError("Dynamic schema references need a dedicated adapter.")
    if "$ref" in value:
        ref = value["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/"):
            raise ConnectionError(
                "External schema references are not fetched; provide a bundled document."
            )
        if ref in trail:
            raise ConnectionError("Recursive schema requires a dedicated adapter.")
        target = select_path(doc, ref[1:])
        if not isinstance(target, dict):
            raise ConnectionError("Schema reference must resolve to an object.")
        return resolve(
            {**target, **{k: v for k, v in value.items() if k != "$ref"}},
            doc,
            (*trail, ref),
            budget,
        )
    result = {k: resolve(v, doc, (*trail, k), budget) for k, v in value.items()}
    if str(doc["openapi"]).startswith("3.0."):
        if result.pop("nullable", False) and "type" in result:
            result["type"] = [result["type"], "null"]
            if "enum" in result:
                result["enum"] = [*result["enum"], None]
        for boundary in ("Minimum", "Maximum"):
            key = "exclusive" + boundary
            if isinstance(result.get(key), bool):
                active = result.pop(key)
                if active and boundary.lower() in result:
                    result[key] = result.pop(boundary.lower())
    return result


def input_schema(schema):
    if not isinstance(schema, dict):
        return schema
    result = {
        k: input_schema(v)
        if isinstance(v, dict)
        else [input_schema(i) for i in v]
        if isinstance(v, list)
        else v
        for k, v in schema.items()
    }
    properties = result.get("properties", {})
    readonly = {
        key
        for key, value in properties.items()
        if isinstance(value, dict) and value.get("readOnly")
    }
    if readonly:
        result["properties"] = {
            k: v for k, v in properties.items() if k not in readonly
        }
        result["required"] = [
            k for k in result.get("required", []) if k not in readonly
        ]
    return result


def server_url(doc, path_item, operation, spec):
    servers = operation.get(
        "servers", path_item.get("servers", doc.get("servers", [{"url": "/"}]))
    )
    chosen = servers[0] if servers else {"url": "/"}
    value = spec.config.get("server_url", chosen.get("url", "/"))
    if not isinstance(value, str):
        raise ConnectionError("Invalid OpenAPI server URL.")
    for key, settings in (
        {} if spec.config.get("server_url") else chosen.get("variables", {})
    ).items():
        if "default" not in settings:
            raise ConnectionError(
                "Server variables require defaults or a server_url override."
            )
        value = value.replace("{" + key + "}", str(settings["default"]))
    if "{" in value or "}" in value:
        raise ConnectionError("Unresolved server variable.")
    value = urljoin(spec.url, value)
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ConnectionError("Server URL must be a credential-free HTTP(S) base URL.")
    if origin(value) != origin(spec.url):
        raise ConnectionError(
            "OpenAPI operations must use the registered document origin."
        )
    return value.rstrip("/")


def path_item(value, doc):
    """Resolve path-item references without expanding response payload schemas."""
    seen = set()
    while isinstance(value, dict) and "$ref" in value:
        ref = value["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/"):
            raise ConnectionError(
                "External path references require a bundled document."
            )
        if ref in seen or len(seen) > 64:
            raise ConnectionError("Recursive path reference.")
        seen.add(ref)
        target = select_path(doc, ref[1:])
        if not isinstance(target, dict):
            raise ConnectionError("Path reference must resolve to an object.")
        value = {**target, **{k: v for k, v in value.items() if k != "$ref"}}
    if not isinstance(value, dict):
        raise ConnectionError("Path item must be an object.")
    return value


def operations(doc, spec):
    found = []
    used = set()
    for path, raw_item in doc.get("paths", {}).items():
        if (
            not path.startswith("/")
            or path.startswith("//")
            or "?" in path
            or "#" in path
        ):
            continue
        try:
            item = path_item(raw_item, doc)
        except ConnectionError as error:
            found.append(
                {
                    "name": path,
                    "available": False,
                    "reason": str(error),
                    "inputSchema": {},
                }
            )
            continue
        for method, operation in item.items():
            if method not in METHODS | {"trace"} or not isinstance(operation, dict):
                continue
            name = operation.get("operationId") or method.upper() + " " + path
            entry = {
                "name": name,
                "description": operation.get(
                    "summary", operation.get("description", "")
                ),
                "method": method.upper(),
                "path": path,
                "requiresConfirmation": method not in {"get", "head", "options"},
                "available": True,
            }
            try:
                if method not in METHODS:
                    raise ConnectionError("Unsupported HTTP method: " + method.upper())
                if name in used:
                    raise ConnectionError("Duplicate operationId.")
                used.add(name)
                entry["server"] = server_url(doc, item, operation, spec)
                groups = {}
                params = {
                    (p.get("in"), p.get("name")): p
                    for p in resolve(
                        [
                            *item.get("parameters", []),
                            *operation.get("parameters", []),
                        ],
                        doc,
                    )
                }
                for (location, param_name), parameter in params.items():
                    if location not in {"path", "query", "header"}:
                        raise ConnectionError(
                            "This parameter location requires a dedicated adapter: "
                            + str(location)
                        )
                    if param_name in BAD_KEYS or not isinstance(param_name, str):
                        raise ConnectionError("Unsafe parameter name.")
                    if location == "header" and (
                        param_name.lower() in BLOCKED_HEADERS
                        or (
                            spec.auth and param_name.lower() == spec.auth.header.lower()
                        )
                    ):
                        # Authentication is supplied by server environment reference, never a form.
                        if param_name.lower() == "authorization" or (
                            spec.auth and param_name.lower() == spec.auth.header.lower()
                        ):
                            continue
                        raise ConnectionError("Reserved header parameter.")
                    style = parameter.get(
                        "style", "form" if location == "query" else "simple"
                    )
                    if style not in (
                        {"form", "spaceDelimited", "pipeDelimited", "deepObject"}
                        if location == "query"
                        else {"simple"}
                    ):
                        raise ConnectionError("Unsupported parameter style: " + style)
                    if parameter.get("allowReserved"):
                        raise ConnectionError(
                            "allowReserved requires a dedicated adapter."
                        )
                    if "content" in parameter:
                        raise ConnectionError(
                            "Content-encoded parameters require a dedicated adapter."
                        )
                    group = groups.setdefault(
                        location,
                        {
                            "type": "object",
                            "properties": {},
                            "required": [],
                            "additionalProperties": False,
                        },
                    )
                    group["properties"][param_name] = input_schema(
                        parameter.get("schema", {})
                    )
                    if parameter.get("required") or location == "path":
                        group["required"].append(param_name)
                body = resolve(operation.get("requestBody", {}), doc)
                content = body.get("content", {})
                if content and "application/json" not in content:
                    raise ConnectionError(
                        "Only JSON request bodies are supported by this adapter."
                    )
                schema = {
                    "type": "object",
                    "properties": groups,
                    "required": [
                        key for key, group in groups.items() if group["required"]
                    ],
                    "additionalProperties": False,
                }
                if content:
                    schema["properties"]["body"] = input_schema(
                        content["application/json"].get("schema", {})
                    )
                    if body.get("required"):
                        schema["required"].append("body")
                Draft202012Validator.check_schema(schema)
                entry.update(
                    {
                        "inputSchema": schema,
                        "parameters": list(params.values()),
                        "responses": operation.get("responses", {}),
                        "security": operation.get("security", doc.get("security", [])),
                    }
                )
            except (
                ConnectionError,
                ValueError,
                TypeError,
                AttributeError,
                SchemaError,
            ) as error:
                entry.update(
                    {"available": False, "reason": str(error), "inputSchema": {}}
                )
            found.append(entry)
            if len(found) > 1000:
                raise ConnectionError("OpenAPI operation limit exceeded.")
    duplicates = {
        entry["name"]
        for entry in found
        if sum(other["name"] == entry["name"] for other in found) > 1
    }
    for entry in found:
        if entry["name"] in duplicates:
            entry.update({"available": False, "reason": "Duplicate operationId."})
    return found


async def discover(spec, allow_private, timeout):
    async with http_client(spec, allow_private, timeout) as client:
        doc = await document(client, spec)
    entries = operations(doc, spec)
    return {
        "verified": True,
        "protocolVersion": doc["openapi"],
        "tools": entries,
        "note": "Schema fetched; operations have not been invoked. Unsupported operations remain visible with reasons.",
    }


def scalar(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        raise ConnectionError("Nested parameter values need a dedicated adapter.")
    return str(value).lower() if isinstance(value, bool) else str(value)


def serialize_parameter(parameter, value):
    name, location = parameter["name"], parameter["in"]
    style = parameter.get("style", "form" if location == "query" else "simple")
    explode = parameter.get("explode", style == "form")
    if style in {"spaceDelimited", "pipeDelimited"} and (
        not isinstance(value, list) or explode
    ):
        raise ConnectionError(
            "Delimited query parameters require an array with explode=false."
        )
    if style == "deepObject":
        if not isinstance(value, dict):
            raise ConnectionError("deepObject requires an object value.")
        return [(f"{name}[{key}]", scalar(item)) for key, item in value.items()]
    if isinstance(value, dict):
        if location == "query" and explode:
            return [(key, scalar(item)) for key, item in value.items()]
        parts = (
            [f"{key}={scalar(item)}" for key, item in value.items()]
            if explode
            else [scalar(part) for pair in value.items() for part in pair]
        )
    elif isinstance(value, list):
        if location == "query" and explode and style == "form":
            return [(name, scalar(item)) for item in value]
        parts = [scalar(item) for item in value]
    else:
        parts = [scalar(value)]
    separator = (
        " " if style == "spaceDelimited" else "|" if style == "pipeDelimited" else ","
    )
    return [(name, separator.join(parts))]


async def execute(spec, run, allow_private, timeout):
    async with http_client(spec, allow_private, timeout) as client:
        doc = await document(client, spec)
        name = spec.config.get("a2ui_operation") if run.a2ui_messages else run.tool
        operation = next(
            (entry for entry in operations(doc, spec) if entry["name"] == name), None
        )
        if operation is None:
            raise ConnectionError(
                "Select an operation, or configure a2ui_operation for UI events."
            )
        if not operation["available"]:
            raise ConnectionError(operation["reason"])
        if operation["requiresConfirmation"] and not run.confirmed:
            raise ConnectionError(
                "Confirm this operation before executing a potentially state-changing request."
            )
        values = (
            {"body": {"messages": run.a2ui_messages, "metadata": run.metadata}}
            if run.a2ui_messages
            else run.input
        )
        error = next(
            Draft202012Validator(operation["inputSchema"]).iter_errors(values), None
        )
        if error:
            raise ConnectionError(
                "Operation input does not match its schema: " + error.message
            )
        path = operation["path"]
        query, headers = [], {}
        for parameter in operation["parameters"]:
            location, key = parameter["in"], parameter["name"]
            if key not in values.get(location, {}):
                continue
            pairs = serialize_parameter(parameter, values[location][key])
            if location == "path":
                encoded = quote(pairs[0][1], safe="")
                if encoded in {".", ".."}:
                    raise ConnectionError("Dot path parameters are not allowed.")
                path = path.replace("{" + key + "}", encoded)
            elif location == "query":
                query.extend(pairs)
            else:
                if key.lower() in BLOCKED_HEADERS or (
                    spec.auth and key.lower() == spec.auth.header.lower()
                ):
                    raise ConnectionError("Reserved header parameter.")
                headers[key] = pairs[0][1]
        if re.search(r"[{}]", path):
            raise ConnectionError("Unresolved path parameter.")
        url = operation["server"] + path
        kwargs = {"params": query, "headers": headers}
        if "body" in values:
            kwargs["json"] = values["body"]
        async with client.stream(operation["method"], url, **kwargs) as response:
            response.raise_for_status()
            raw = await read_body(response)
            mime = response.headers.get(
                "content-type", "application/octet-stream"
            ).split(";")[0]
            if not raw:
                value = {
                    "kind": "status",
                    "text": f"HTTP {response.status_code}: operation completed.",
                }
            elif mime == "application/json" or mime.endswith("+json"):
                value = json.loads(raw)
            elif mime.startswith("text/"):
                value = raw.decode("utf-8", errors="replace")
            else:
                value = {
                    "kind": "file",
                    "mimeType": mime,
                    "name": "response",
                    "bytes": base64.b64encode(raw).decode(),
                }
            yield result_event(value)
