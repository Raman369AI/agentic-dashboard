from __future__ import annotations

from app.config import get_settings
from app.domain.registry import AgentRegistry, invoke_agent


def _registry() -> AgentRegistry:
    return AgentRegistry(get_settings().registry_db)


def list_connected_agents() -> dict:
    """List every remote A2A agent currently connected to the workspace."""
    agents = [agent.as_dict() for agent in _registry().all()]
    return {"status": "success", "count": len(agents), "agents": agents}


async def delegate_to_agent(agent_id: str, request: str) -> dict:
    """Delegate a request to a registered remote A2A agent.

    Args:
        agent_id: The registry identifier returned by list_connected_agents.
        request: The complete task to send to the remote agent.
    """
    settings = get_settings()
    record = _registry().get(agent_id)
    if record is None:
        return {"status": "error", "message": "Agent not found."}
    try:
        events = await invoke_agent(
            record,
            request,
            settings.agent_timeout_seconds,
            settings.allow_private_agents,
        )
    except (
        Exception
    ) as error:  # Remote protocols can fail in many vendor-specific ways.
        return {"status": "error", "message": str(error), "agent": record.name}
    return {"status": "success", "agent": record.name, "events": events}


def workspace_snapshot() -> dict:
    """Return configured-service counts; do not fabricate runtime health metrics."""
    from app.connections import ConnectionStore

    agents = _registry().all()
    records = ConnectionStore(get_settings().registry_db).all()
    return {
        "status": "success",
        "legacy_a2a_agents": len(agents),
        "connections": [
            {"name": record["name"], "kind": record["kind"]} for record in records
        ],
        "connection_count": len(records),
        "runtime_health": "Not probed; registry entries do not establish live health.",
    }


def list_connections() -> dict:
    """Discover configured A2A, AG-UI, HTTP, and MCP services and input schemas."""
    from app.connections import ConnectionStore

    records = ConnectionStore(get_settings().registry_db).all()
    return {
        "connections": [
            {
                "id": record["id"],
                "name": record["name"],
                "kind": record["kind"],
                "description": record["description"],
                "discovery": record["discovery"],
                "input_schema": record["http"]["input_schema"],
            }
            for record in records
        ]
    }


async def query_connection(
    connection_id: str, prompt: str, tool_name: str, arguments_json: str
) -> dict:
    """Query a configured service; use list_connections first for schemas.

    Args:
        connection_id: Exact identifier returned by list_connections.
        prompt: User request for agent or HTTP endpoints.
        tool_name: Discovered MCP tool name, or empty for non-MCP services.
        arguments_json: JSON object matching the discovered input schema.
    """
    import json

    from app.connections import ConnectionStore, RunInput, run_events, spec_from_record

    settings = get_settings()
    record = ConnectionStore(settings.registry_db).get(connection_id)
    if record is None:
        return {"status": "error", "message": "Connection not found."}
    try:
        arguments = json.loads(arguments_json)
        run = RunInput(prompt=prompt, tool=tool_name or None, input=arguments)
    except (ValueError, TypeError):
        return {"status": "error", "message": "Provide valid JSON object arguments."}
    events = [
        event
        async for event in run_events(
            spec_from_record(record),
            run,
            settings.allow_private_agents,
            settings.agent_timeout_seconds,
        )
    ]
    return {
        "status": "error"
        if any(event.get("type") == "RUN_ERROR" for event in events)
        else "success",
        "events": events,
    }
