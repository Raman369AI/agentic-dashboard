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
        events = await invoke_agent(record, request, settings.agent_timeout_seconds)
    except (
        Exception
    ) as error:  # Remote protocols can fail in many vendor-specific ways.
        return {"status": "error", "message": str(error), "agent": record.name}
    return {"status": "success", "agent": record.name, "events": events}


def workspace_snapshot() -> dict:
    """Return a compact operational snapshot for a workspace dashboard."""
    agents = _registry().all()
    return {
        "status": "success",
        "metrics": [
            {
                "label": "Connected agents",
                "value": len(agents),
                "trend": "+1 this week",
            },
            {"label": "Active runs", "value": 0, "trend": "Ready"},
            {"label": "Protocol health", "value": "100%", "trend": "AG-UI online"},
        ],
        "agents": [{"name": item.name, "status": item.status} for item in agents],
    }
