"""A no-network semantic function adapter; replace the function with your own SDK."""

from jsonschema import Draft202012Validator

from app.adapters import Adapter
from app.connections import ConnectionError, result_event

SCHEMA = {
    "type": "object",
    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
    "required": ["x", "y"],
    "additionalProperties": False,
}


async def discover(spec, allow_private, timeout):
    return {"verified": True, "tools": [{"name": "sum", "inputSchema": SCHEMA}]}


async def execute(spec, run, allow_private, timeout):
    if (
        run.a2ui_messages
        or run.tool != "sum"
        or not Draft202012Validator(SCHEMA).is_valid(run.input)
    ):
        raise ConnectionError("Choose sum and supply numeric x and y.")
    # Call your own async SDK here. Offload blocking calls to a worker thread.
    value = run.input["x"] + run.input["y"]
    yield result_event(
        {
            "kind": "metric",
            "label": spec.config.get("label", "Local total"),
            "value": value,
        }
    )


adapter = Adapter(
    kind="example.local",
    label="Local function adapter",
    discover=discover,
    execute=execute,
    requires_endpoint=False,
    config_schema={
        "type": "object",
        "properties": {"label": {"type": "string"}},
        "additionalProperties": False,
    },
    capabilities=("operations", "structuredInput"),
)
