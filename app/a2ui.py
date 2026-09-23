"""Pinned A2UI v1 wire validation and ADK-facing tools (no remote schema fetches)."""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path

import regex
from jsonschema import Draft202012Validator, FormatChecker, ValidationError, validators
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

SCHEMA_DIR = Path(__file__).with_name("a2ui_schema")
BASE = "https://a2ui.org/specification/v1_0/"
EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v1.0"
MIME_TYPE = "application/a2ui+json"
BASIC_CATALOG = json.loads((SCHEMA_DIR / "basic_catalog.json").read_text())


def unicode_pattern(validator, pattern, instance, schema):
    if isinstance(instance, str) and not regex.search(pattern, instance, timeout=0.1):
        yield ValidationError("String does not match the required pattern.")


UnicodeValidator = validators.extend(Draft202012Validator, {"pattern": unicode_pattern})


@lru_cache
def wire_validator(direction: str, catalog_bound: bool = False):
    schemas = {}
    for path in SCHEMA_DIR.glob("*.json"):
        schema = json.loads(path.read_text())
        if "$id" in schema:
            schemas[schema["$id"]] = schema
    common = copy.deepcopy(schemas[BASE + "common_types.json"])
    # Equivalent UAX-31 constraint using propertyNames: jsonschema's stock
    # patternProperties/additionalProperties use Python re, which lacks Unicode properties.
    common["$defs"]["Extensions"] = {
        "type": "object",
        "propertyNames": {"pattern": r"^[\p{XID_Start}_][\p{XID_Continue}]*$"},
    }
    schemas[common["$id"]] = common
    catalog = (
        copy.deepcopy(BASIC_CATALOG)
        if catalog_bound
        else {
            "$defs": {
                "anyComponent": {"type": "object"},
                "anyFunction": {
                    "type": "object",
                    "properties": {
                        "call": {"type": "string", "pattern": "^[^@]"},
                        "args": {"type": "object"},
                    },
                    "required": ["call"],
                },
            }
        }
    )
    catalog["$id"] = BASE + "catalog.json"
    schemas[catalog["$id"]] = catalog
    registry = Registry().with_resources(
        (uri, Resource.from_contents(schema, default_specification=DRAFT202012))
        for uri, schema in schemas.items()
    )
    return UnicodeValidator(
        schemas[BASE + direction + ".json"],
        registry=registry,
        format_checker=FormatChecker(),
    )


def validate_messages(
    messages: list[dict], direction: str, *, catalog_bound: bool = False
) -> None:
    if len(messages) > 100 or len(json.dumps(messages).encode()) > 1024 * 1024:
        raise ValueError("A2UI batch exceeds the 100-message / 1 MiB limit.")
    validator = wire_validator(direction, catalog_bound)
    for index, message in enumerate(messages):
        error = next(validator.iter_errors(message), None)
        if error:
            path = "/".join(map(str, error.absolute_path))
            raise ValueError(
                f"A2UI message {index} is invalid at /{path}: {error.validator}."
            )


def get_a2ui_catalog() -> dict:
    """Read the supported A2UI v1 catalog before creating a dashboard or form."""
    return {
        "version": "v1.0",
        "catalog": BASIC_CATALOG,
        "message_schema": json.loads(
            (SCHEMA_DIR / "agent_to_renderer.json").read_text()
        ),
        "common_types": json.loads((SCHEMA_DIR / "common_types.json").read_text()),
        "rules": "Send a JSON array to render_a2ui_v1. Create each surface once with a globally unique ID and a root component. Bind input values to dataModel paths. Later update that surface instead of creating it again. Function defaults use the surface catalog, not a component's override.",
    }


def render_a2ui_v1(messages_json: str) -> dict:
    """Validate and display A2UI v1 messages. Consult get_a2ui_catalog first.

    Args:
        messages_json: JSON array of version v1.0 agent-to-renderer messages.
    """
    try:
        messages = json.loads(messages_json)
        if not isinstance(messages, list):
            raise ValueError("Expected a JSON array of A2UI messages.")
        validate_messages(messages, "agent_to_renderer", catalog_bound=True)
        return {"a2ui_messages": messages}
    except (ValueError, TypeError, RecursionError) as error:
        return {"status": "error", "message": str(error)}
