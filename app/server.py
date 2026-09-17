from __future__ import annotations

from contextlib import asynccontextmanager

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.agent import root_agent
from app.config import get_settings
from app.domain.registry import (
    AgentRegistry,
    RegistryError,
    discover_agent,
    invoke_agent,
    validate_remote_url,
)

settings = get_settings()
registry = AgentRegistry(settings.registry_db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


api = FastAPI(
    title="Agentic Dashboard API",
    version="0.1.0",
    description="Google ADK control plane with AG-UI, A2UI, and A2A.",
    lifespan=lifespan,
)
api.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterAgentRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class InvokeAgentRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=50_000)


@api.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "protocols": {"agUi": "0.1", "a2ui": "0.9", "a2a": "0.3"},
    }


@api.get("/api/agents")
async def list_agents() -> dict:
    return {"agents": [item.as_dict() for item in registry.all()]}


@api.post("/api/agents", status_code=status.HTTP_201_CREATED)
async def register_agent(request: RegisterAgentRequest) -> dict:
    try:
        base_url = await validate_remote_url(request.url, settings.allow_private_agents)
        card = await discover_agent(base_url, settings.agent_timeout_seconds)
        await validate_remote_url(
            str(card.get("url", base_url)), settings.allow_private_agents
        )
        for interface in card.get("additionalInterfaces", []):
            if isinstance(interface, dict) and interface.get("url"):
                await validate_remote_url(
                    str(interface["url"]), settings.allow_private_agents
                )
        return registry.save(base_url, card).as_dict()
    except RegistryError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502, detail=f"Agent discovery failed: {error}"
        ) from error


@api.delete("/api/agents/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_agent(agent_id: str) -> Response:
    if not registry.delete(agent_id):
        raise HTTPException(status_code=404, detail="Agent not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.post("/api/agents/{agent_id}/invoke")
async def invoke_registered_agent(agent_id: str, request: InvokeAgentRequest) -> dict:
    record = registry.get(agent_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Agent not found.")
    try:
        return {
            "events": await invoke_agent(
                record, request.prompt, settings.agent_timeout_seconds
            )
        }
    except Exception as error:
        raise HTTPException(
            status_code=502, detail=f"Remote invocation failed: {error}"
        ) from error


agui_agent = ADKAgent(
    adk_agent=root_agent,
    app_name=settings.app_name,
    user_id="dashboard-user",
    use_thread_id_as_session_id=True,
    emit_messages_snapshot=True,
    capabilities={
        "streaming": True,
        "state": True,
        "custom": {"a2ui": "0.9", "a2aRegistry": True, "artifacts": True},
    },
    a2ui={
        "inject_a2ui_tool": True,
        "default_catalog_id": "https://agentic-dashboard.local/catalog/v0.9",
        "guidelines": (
            "Create dense, useful workspace dashboards. Prefer Card, Column, Row, "
            "Text, Button, TextField and Divider. Keep labels short."
        ),
    },
)
add_adk_fastapi_endpoint(api, agui_agent, path="/api/ag-ui")

app = api
