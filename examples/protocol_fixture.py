"""Deterministic interoperability fixture. No model calls or credentials required."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.agents import BaseAgent
from google.adk.events import Event
from google.genai import types
from mcp.server import MCPServer
from pydantic import BaseModel

from examples.a2ui_fixture import router as a2ui_router
from examples.visual_fixture import router as visual_router

mcp = MCPServer("Example semantic layer")


@mcp.tool()
def revenue(region: str) -> dict:
    """Return quarterly revenue for a region."""
    return {
        "blocks": [
            {"type": "text", "text": f"Revenue for **{region}**"},
            {
                "type": "table",
                "rows": [
                    {"quarter": "Q1", "revenue": 120},
                    {"quarter": "Q2", "revenue": 180},
                ],
            },
            {
                "type": "chart",
                "title": "Quarterly revenue",
                "xKey": "quarter",
                "yKey": "revenue",
                "data": [
                    {"quarter": "Q1", "revenue": 120},
                    {"quarter": "Q2", "revenue": 180},
                ],
            },
        ]
    }


mcp_app = mcp.streamable_http_app(stateless_http=True)


@asynccontextmanager
async def lifespan(_):
    async with mcp_app.router.lifespan_context(mcp_app):
        yield


app = FastAPI(lifespan=lifespan)
app.include_router(a2ui_router)
app.include_router(visual_router)


@app.post("/query")
async def query(body: dict) -> dict:
    region = body.get("query", {}).get("region", "All")
    return {
        "answer": revenue(region),
        "metadata": {"source": "example semantic service"},
    }


@app.post("/ag-ui")
async def agui(body: dict):
    import json

    async def events():
        payloads = [
            {
                "type": "RUN_STARTED",
                "threadId": body["threadId"],
                "runId": body["runId"],
            },
            {"type": "TEXT_MESSAGE_START", "messageId": "fixture", "role": "assistant"},
            {
                "type": "TEXT_MESSAGE_CONTENT",
                "messageId": "fixture",
                "delta": "AG-UI fixture connected.",
            },
            {"type": "TEXT_MESSAGE_END", "messageId": "fixture"},
            {
                "type": "CUSTOM",
                "name": "result",
                "value": {"type": "metric", "label": "Active accounts", "value": 42},
            },
            {"type": "STATE_SNAPSHOT", "snapshot": {"count": 1}},
            {
                "type": "STATE_DELTA",
                "delta": [{"op": "replace", "path": "/count", "value": 2}],
            },
            {
                "type": "RUN_FINISHED",
                "threadId": body["threadId"],
                "runId": body["runId"],
            },
        ]
        for payload in payloads:
            yield "data: " + json.dumps(payload) + "\r\n\r\n"

    return StreamingResponse(events(), media_type="text/event-stream")


class SemanticQuery(BaseModel):
    region: str
    limit: int = 10


@app.get("/inventory/{region}", operation_id="inventory")
async def inventory(region: str, limit: int = 10):
    return {"rows": [{"region": region, "units": limit}]}


@app.post("/semantic/query", operation_id="semantic_query")
async def semantic_query(body: SemanticQuery):
    return revenue(body.region)


app.mount("/", mcp_app)


class EchoAgent(BaseAgent):
    async def _run_async_impl(self, ctx):
        text = "".join(part.text or "" for part in ctx.user_content.parts)
        yield Event(
            author=self.name,
            content=types.Content(
                role="model",
                parts=[types.Part.from_text(text=f"A2A fixture received: {text}")],
            ),
        )


# Reuses the same ADK wrapper as app/a2a_server.py, with a deterministic agent.
a2a_app = to_a2a(
    EchoAgent(name="protocol_fixture", description="A no-model test agent"),
    host="127.0.0.1",
    port=9102,
)
