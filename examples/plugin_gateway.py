"""Example trusted adapter installed at startup; no changes to the web client."""

from app.adapters import Adapter, register_adapter
from app.connections import ConnectionError, http_client, result_event
from app.server import app  # noqa: F401
from examples.local_adapter import adapter as local_adapter

register_adapter(local_adapter)


async def discover(spec, allow_private, timeout):
    # A known vendor contract can publish its input schema without invoking it.
    return {
        "verified": False,
        "tools": [
            {
                "name": "query",
                "description": "Query a service through the example vendor adapter.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"region": {"type": "string"}},
                    "required": ["region"],
                    "additionalProperties": False,
                },
            }
        ],
    }


async def execute(spec, run, allow_private, timeout):
    from jsonschema import Draft202012Validator

    if run.tool != "query":
        raise ConnectionError("Select the query operation.")
    if run.a2ui_messages:
        raise ConnectionError("This example does not implement an A2UI return channel.")
    schema = (await discover(spec, allow_private, timeout))["tools"][0]["inputSchema"]
    if not Draft202012Validator(schema).is_valid(run.input):
        raise ConnectionError("Expected a region string.")
    async with http_client(spec, allow_private, timeout) as client:
        # Translate the host contract to this service's request and response envelopes.
        # Production adapters should stream/limit large responses (see OpenAPI adapter).
        async with client.stream(
            "POST", spec.url, json={"query": run.input}
        ) as response:
            import json

            from app.adapters.openapi import read_body

            response.raise_for_status()
            payload = json.loads(await read_body(response))
    yield result_event(payload["answer"])


register_adapter(
    Adapter(
        kind="example.semantic",
        label="Example semantic adapter",
        discover=discover,
        execute=execute,
        capabilities=("operations", "structuredInput"),
    )
)
