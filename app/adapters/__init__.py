"""Trusted, framework-neutral adapter SDK. Remote manifests never import code."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from jsonschema import Draft202012Validator

if TYPE_CHECKING:
    from app.connections import ConnectionSpec, RunInput

Discover = Callable[["ConnectionSpec", bool, float], Awaitable[dict]]
Execute = Callable[["ConnectionSpec", "RunInput", bool, float], AsyncIterator[dict]]


@dataclass(frozen=True)
class Adapter:
    kind: str
    label: str
    discover: Discover
    execute: Execute
    config_schema: dict = field(
        default_factory=lambda: {"type": "object", "additionalProperties": False}
    )
    capabilities: tuple[str, ...] = ()
    requires_endpoint: bool = True
    requires_terminal_event: bool = False
    contract_version: str = "1.0"

    def descriptor(self) -> dict:
        return {
            "kind": self.kind,
            "label": self.label,
            "contractVersion": self.contract_version,
            "configSchema": self.config_schema,
            "capabilities": list(self.capabilities),
            "requiresEndpoint": self.requires_endpoint,
        }


_registry: dict[str, Adapter] = {}
_BUILTINS = {"a2a", "agui", "mcp", "http", "openapi"}


def register_adapter(adapter: Adapter) -> None:
    """Install trusted server code at application startup, never from a request."""
    import re

    if not re.fullmatch(r"[a-z][a-z0-9_.-]{0,63}", adapter.kind):
        raise ValueError("Invalid adapter kind.")
    if adapter.kind in _registry or adapter.kind in _BUILTINS:
        raise ValueError("Adapter kind is already registered or reserved.")
    if adapter.contract_version != "1.0":
        raise ValueError("Unsupported adapter contract version.")
    Draft202012Validator.check_schema(adapter.config_schema)
    _registry[adapter.kind] = adapter


def _builtins() -> dict[str, Adapter]:
    from app.adapters.openapi import discover, execute
    from app.connections import _discover_builtin, _execute_builtin

    return {
        kind: Adapter(
            kind,
            label,
            _discover_builtin,
            _execute_builtin,
            capabilities=caps,
            requires_terminal_event=kind == "agui",
        )
        for kind, label, caps in [
            ("a2a", "A2A agent", ("chat", "a2ui")),
            ("agui", "AG-UI agent", ("chat", "streaming", "a2ui")),
            (
                "mcp",
                "MCP tools / semantic layer",
                ("operations", "structuredInput", "a2ui"),
            ),
            ("http", "HTTP / semantic API", ("chat", "structuredInput", "a2ui")),
        ]
    } | {
        "openapi": Adapter(
            "openapi",
            "OpenAPI service",
            discover,
            execute,
            config_schema={
                "type": "object",
                "properties": {
                    "server_url": {
                        "type": "string",
                        "description": "Optional same-origin server override.",
                    },
                    "a2ui_operation": {
                        "type": "string",
                        "description": "Explicit UI return operation ID.",
                    },
                },
                "additionalProperties": False,
            },
            capabilities=("operations", "structuredInput", "a2ui"),
        )
    }


def adapters() -> dict[str, Adapter]:
    return {**_builtins(), **_registry}


def get_adapter(kind: str) -> Adapter:
    adapter = adapters().get(kind)
    if adapter is None:
        from app.connections import ConnectionError

        raise ConnectionError(f"Adapter '{kind}' is not installed in this gateway.")
    return adapter


def validate_config(adapter: Adapter, config: dict) -> None:
    errors = list(Draft202012Validator(adapter.config_schema).iter_errors(config))
    if errors:
        from app.connections import ConnectionError

        raise ConnectionError(
            "Adapter configuration does not match its schema: " + errors[0].message
        )
