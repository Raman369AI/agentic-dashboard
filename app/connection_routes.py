from __future__ import annotations

import json

import anyio
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.connections import (
    ConnectionSpec,
    ConnectionStore,
    RunInput,
    discover,
    public_error,
    run_events,
    spec_from_record,
)

router = APIRouter(prefix="/api/connections", tags=["Connections"])


def store() -> ConnectionStore:
    return ConnectionStore(get_settings().registry_db)


@router.get("/adapters")
async def list_adapters() -> dict:
    from app.adapters import adapters

    return {
        "contractVersion": "1.0",
        "adapters": [adapter.descriptor() for adapter in adapters().values()],
    }


@router.get("/visualizations")
async def visualization_capabilities() -> dict:
    """Machine-readable result contracts for any connected agent or adapter."""
    from importlib.resources import files

    return json.loads(files("app").joinpath("visualizations.json").read_text())


@router.get("")
async def list_connections() -> dict:
    return {"connections": store().all()}


@router.post("", status_code=201)
async def add_connection(spec: ConnectionSpec) -> dict:
    settings = get_settings()
    try:
        with anyio.fail_after(settings.agent_timeout_seconds):
            discovery = await discover(
                spec, settings.allow_private_agents, settings.agent_timeout_seconds
            )
        return store().save(spec, discovery)
    except Exception as error:
        raise HTTPException(400, public_error(error)) from error


def get_connection(connection_id: str) -> dict:
    record = store().get(connection_id)
    if record is None:
        raise HTTPException(404, "Connection not found.")
    return record


@router.post("/{connection_id}/discover")
async def discover_connection(connection_id: str) -> dict:
    spec = spec_from_record(get_connection(connection_id))
    settings = get_settings()
    try:
        with anyio.fail_after(settings.agent_timeout_seconds):
            discovery = await discover(
                spec, settings.allow_private_agents, settings.agent_timeout_seconds
            )
        store().update_discovery(connection_id, discovery)
        return discovery
    except Exception as error:
        raise HTTPException(400, public_error(error)) from error


@router.delete("/{connection_id}", status_code=204)
async def delete_connection(connection_id: str) -> Response:
    if not store().delete(connection_id):
        raise HTTPException(404, "Connection not found.")
    return Response(status_code=204)


@router.post("/{connection_id}/run")
async def run_connection(connection_id: str, run: RunInput) -> StreamingResponse:
    spec = spec_from_record(get_connection(connection_id))
    settings = get_settings()

    async def stream():
        async for event in run_events(
            spec, run, settings.allow_private_agents, settings.agent_timeout_seconds
        ):
            yield "data: " + json.dumps(event) + "\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
