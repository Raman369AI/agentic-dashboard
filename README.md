# Relay - Agentic Dashboard

Relay is a standalone, protocol-first workspace for Google ADK agents. It combines
streaming chat, a trusted generative-dashboard canvas, an A2A agent registry,
artifacts, and an inspectable activity stream in one repository.

The dashboard can run as its own FastAPI service, or it can become the UI and
agent layer of an existing FastAPI application.

## Included

- Google ADK coordinator using `gemini-3-flash-preview`
- AG-UI SSE endpoint with messages, state, tools, and run lifecycle events
- A2UI v0.9 generation pipeline and allowlisted React renderer
- Remote A2A Agent Card discovery, persistence, invocation, and removal
- Direct chat with a selected remote agent or delegated chat through the coordinator
- Dynamic rendering for text, JSON, tables, images, audio, video, files, and A2UI
- Chat, dashboards, runs, artifacts, tools, activity, settings, and agent management
- Responsive standalone React/Vite client
- SSRF protection and a local SQLite agent registry
- A separate A2A endpoint so other applications can use Relay's coordinator

## Architecture

```text
web/ React client
  |- Chat and streamed AG-UI events
  |- Dynamic result normalizer
  |- Safe A2UI component renderer
  `- A2A registry and direct-agent controls
              |
              | /api/*
              v
app/server.py (FastAPI + AG-UI adapter)
              |
              v
app/agent.py (Google ADK coordinator)
  |- local ADK tools
  `- registered remote A2A agents
```

The browser and agent service are separate applications during development:

- React/Vite: `http://localhost:5173`
- FastAPI: `http://localhost:8000`

The browser intentionally calls relative `/api/*` paths. In production, serve
the UI and API from the same origin or configure a reverse proxy that forwards
`/api/*` to Relay's FastAPI process.

## Choose an integration model

| Model | Use it when | Topology |
|---|---|---|
| Standalone Relay | Your existing application should remain unchanged | Existing app and Relay run as separate services |
| Relay as the FastAPI host | You can include your existing API routers in Relay | One FastAPI process serves both applications |
| Separate static UI and API | You deploy frontend assets through a CDN or web server | Static UI plus a reverse-proxied Relay API |
| Embedded remote agents | You want plug-and-play specialist agents | Agents remain independent A2A services |

The recommended production choices are:

1. Use Relay as a sidecar when the existing FastAPI application has its own
   lifecycle, middleware, authentication, or deployment.
2. Use Relay as the host application when both systems can share middleware and
   one process.

## Quick start

Requirements: Python 3.10-3.13, `uv`, Node.js 20+, and `make`.

```bash
cp .env.example .env
# Add GOOGLE_API_KEY to .env, or configure Vertex AI credentials.
make install
make dev
```

Open `http://localhost:5173`. The initial dashboard works without model
credentials; live chat requires Gemini access.

### AI Studio credentials

```dotenv
GOOGLE_API_KEY=your-key
GOOGLE_GENAI_USE_VERTEXAI=false
```

### Vertex AI credentials

Authenticate with Application Default Credentials, then configure:

```dotenv
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
GOOGLE_GENAI_USE_VERTEXAI=true
```

Do not change the configured model to work around a model 404. Check the Vertex
AI location first; Gemini 3 models may require `global`.

## Run Relay as a standalone service

This is the least invasive way to use Relay with an existing FastAPI application.

```bash
make install
make dev
```

Deploy the two Relay processes together or separately:

- Run `app.server:app` as the FastAPI control plane.
- Build and host `web/dist` as static assets.
- Route the browser's `/api/*` requests to the Relay API.
- Leave the existing FastAPI service on its current hostname.

Your existing service can become an A2A plug-in agent, or Relay agents can call
it through an ADK tool or an A2A adapter.

### Same-origin reverse-proxy contract

A separately deployed UI still expects this public layout:

```text
https://dashboard.example.com/          -> web/dist
https://dashboard.example.com/api/*     -> Relay FastAPI
```

If the UI and API use different origins, update the client API adapter and set
`CORS_ORIGINS` to the exact UI origin. Do not use a wildcard origin with
credentialed requests.

## Integrate Relay into an existing FastAPI application

The cleanest single-process integration is to use Relay's FastAPI application as
the host and include your existing `APIRouter` objects before mounting the
static UI.

Create a production entry point such as `production.py`:

```python
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from app.server import api
from your_application.routes import router as application_router

# Keep your existing endpoints under their existing or chosen prefix.
api.include_router(application_router, prefix="/business")

# Mount the UI last so /api routes are matched before static files.
web_dist = Path(__file__).parent / "web" / "dist"
api.mount("/", StaticFiles(directory=web_dist, html=True), name="relay-ui")

app = api
```

Build and run the integrated application:

```bash
npm --prefix web run build
uv run uvicorn production:app --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000`.

Important integration rules:

- Mount static files last.
- Preserve Relay's `/api/ag-ui` and `/api/agents` routes.
- Move conflicting existing routes to another prefix.
- Apply authentication middleware to both the dashboard and API in production.
- Keep long response buffering disabled for `/api/ag-ui`; it is an SSE stream.
- Make sure your proxy permits streaming responses and does not impose a short
  idle timeout.
- Use one process only if your existing application and Relay can safely share
  startup, shutdown, middleware, and dependency configuration.

If your application exports only a complete `FastAPI` instance and cannot
expose routers cleanly, keep Relay as a sidecar. That avoids fragile route and
lifespan merging.

## Integrating agents

Relay supports three useful integration levels.

### 1. Remote A2A agent: recommended plug-in model

Use A2A when an agent should be added or removed without rebuilding Relay. The
agent may be written with Google ADK or another framework, provided it implements
the compatible A2A protocol and publishes an Agent Card.

An agent must provide:

- A resolvable HTTP or HTTPS base URL
- An Agent Card discoverable from the base URL
- A card with at least a name and invocation URL
- An A2A message endpoint compatible with the card
- Text, data, file, artifact, task, or status results
- Network access from the Relay API process

#### Step 1: Create an ADK A2A agent

Use Google's A2A project template rather than manually reconstructing the A2A
server contract:

```bash
uvx agent-starter-pack create inventory-agent \
  --agent adk_a2a \
  --deployment-target none \
  --prototype \
  -y
```

Implement the agent and tools in the generated project, then follow that
project's README to run it. The generated A2A template owns the Agent Card,
request handler, task lifecycle, and protocol serialization.

Relay itself demonstrates the ADK-to-A2A wrapper in `app/a2a_server.py`. Run
Relay's coordinator as an A2A service with:

```bash
make a2a
```

Its base URL is `http://localhost:8001`.

#### Step 2: Verify Agent Card discovery

For a local agent on port 9001:

```bash
curl http://localhost:9001/.well-known/agent-card.json | python -m json.tool
```

Confirm that the card contains the correct public URL. A container must publish
a URL reachable by Relay; `localhost` inside one container does not refer to
another container.

#### Step 3: Permit private addresses only for local development

Relay blocks loopback, private, link-local, reserved, and cloud metadata
addresses by default.

For local development only:

```dotenv
ALLOW_PRIVATE_AGENTS=true
```

Restart the API after changing the environment.

#### Step 4: Register the agent in the UI

1. Open **Agents**.
2. Enter the agent base URL, for example `http://localhost:9001`.
3. Select **Connect**.
4. Relay resolves and validates the Agent Card.
5. The registry stores the card in `data/dashboard.db`.

Enter the base URL, not credentials and not an arbitrary task endpoint. Relay
rejects usernames and passwords embedded in URLs.

You can also register through the API:

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:9001"}'
```

List registered agents:

```bash
curl http://localhost:8000/api/agents | python -m json.tool
```

#### Step 5: Invoke the agent

There are two UI paths:

- Select **Use** in the Agents drawer to chat directly with that agent over A2A.
- Keep the ADK coordinator selected and ask it to delegate. The coordinator
  calls `list_connected_agents` and then `delegate_to_agent`.

Direct API invocation is also available:

```bash
RELAY_AGENT_ID="replace-with-registry-id"

curl -X POST "http://localhost:8000/api/agents/${RELAY_AGENT_ID}/invoke" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Summarize current inventory risk"}'
```

#### Step 6: Remove the agent

```bash
RELAY_AGENT_ID="replace-with-registry-id"
curl -X DELETE "http://localhost:8000/api/agents/${RELAY_AGENT_ID}"
```

Removing a registry entry does not stop or delete the remote agent.

### 2. Add a local ADK tool

Use a local ADK tool when the capability belongs to the coordinator and does not
need independent discovery, deployment, or ownership.

1. Add a typed function in `app/tools.py`.
2. Give it a precise docstring; ADK uses the function signature and description
   as the tool contract.
3. Return JSON-serializable data.
4. Import it in `app/agent.py`.
5. Add it to the existing `tools=[...]` list without changing the configured
   model.
6. Add deterministic tests.
7. Run `make test`, `make lint`, and `make eval`.

Example tool shape:

```python
def get_order_status(order_id: str) -> dict:
    """Return the current status of one order.

    Args:
        order_id: Stable order identifier supplied by the user.
    """
    return {
        "status": "success",
        "orderId": order_id,
        "stage": "in_transit",
    }
```

Local tools are code-coupled. A2A agents are runtime plug-ins.

### 3. Adapt an existing REST service or non-A2A agent

Relay does not guess proprietary HTTP contracts. Wrap the service with an A2A
agent:

1. Scaffold an `adk_a2a` project.
2. Add a tool that calls the existing REST, GraphQL, gRPC, or internal agent API.
3. Translate authentication into server-side headers or workload identity.
4. Convert the response into A2A text, data, file, or artifact parts.
5. Publish the generated Agent Card.
6. Register the adapter's base URL in Relay.

This keeps service-specific credentials and schemas outside the browser and
preserves Relay's plug-and-play contract.

## Returning results that Relay can display

Agents do not have to produce dashboards. Every result is normalized into a
safe display block.

| Agent result | Relay presentation |
|---|---|
| Text part or streamed text | Chat message and text result |
| Array of objects | Table |
| Data part or arbitrary object | Table when flat, otherwise JSON inspector |
| Image file part | Image preview |
| Audio or video file part | Native media player |
| Other file part | Download/open artifact |
| A2UI surface | Interactive dashboard canvas |
| Unknown structured result | Expandable JSON inspector |
| Error | Visible error result and failed run state |

For files, provide a browser-reachable `uri`, or base64 bytes plus an accurate
MIME type. A URI reachable by the agent server but not by the user's browser
cannot be previewed by the client.

### Return a direct A2UI surface

An A2A data part can contain a surface like this:

```json
{
  "surfaceId": "project-intake",
  "components": [
    {
      "id": "root",
      "component": "Card",
      "children": ["title", "name", "priority", "submit"]
    },
    {
      "id": "title",
      "component": "Text",
      "variant": "title",
      "text": "Project intake"
    },
    {
      "id": "name",
      "component": "TextField",
      "label": "Project name",
      "value": { "path": "/project/name" }
    },
    {
      "id": "priority",
      "component": "ChoicePicker",
      "label": "Priority",
      "value": { "path": "/project/priority" },
      "options": ["Low", "Medium", "High"]
    },
    {
      "id": "submit",
      "component": "Button",
      "label": "Submit",
      "action": {
        "event": {
          "name": "submit_project",
          "context": { "workflow": "intake" }
        }
      }
    }
  ],
  "data": {
    "project": {
      "name": "",
      "priority": "Medium"
    }
  }
}
```

Button actions are converted into a new agent message containing the action
name, action context, and current form data. The active coordinator or directly
selected A2A agent receives that message.

### Return streamed A2UI operations

Relay also assembles operation streams that contain:

```json
[
  {
    "createSurface": {
      "surfaceId": "operations"
    }
  },
  {
    "updateComponents": {
      "surfaceId": "operations",
      "components": [
        {
          "id": "root",
          "component": "Metric",
          "label": "Open incidents",
          "value": 3,
          "trend": "Down 2 today"
        }
      ]
    }
  },
  {
    "updateDataModel": {
      "surfaceId": "operations",
      "data": {
        "updatedAt": "2026-09-17T12:00:00Z"
      }
    }
  }
]
```

Supported native component names include:

- Layout: `Column`, `Row`, `Grid`, `Card`, `Divider`, `Tabs`
- Content: `Text`, `Markdown`, `Metric`, `Progress`, `Badge`, `List`,
  `Table`, `Code`
- Input: `TextField`, `Checkbox`, `ChoicePicker`, `Select`, `Button`
- Media: `Image`, `Audio`, `Video`

Unknown components are never executed. They appear as an inspectable JSON
fallback.

## Connect another client to Relay's coordinator

Relay can also act as the plug-in agent rather than the dashboard host.

Start its A2A endpoint:

```bash
make a2a
```

Register `http://localhost:8001` in another A2A client. For production, publish
the correct external host and port in the Agent Card instead of `localhost`.

For browser clients that speak AG-UI, use:

```text
POST /api/ag-ui
Accept: text/event-stream
Content-Type: application/json
```

The request body must follow the AG-UI run input contract. The React client in
`web/src/api.ts` is the working reference for thread IDs, run IDs, messages,
state, context, forwarded properties, and client tools.

## Security and authentication

Before production use:

- Keep `ALLOW_PRIVATE_AGENTS=false`.
- Put authentication and authorization in front of the UI and every `/api/*`
  endpoint.
- Use HTTPS for public agents and the dashboard.
- Store secrets in environment variables or a secret manager.
- Never include credentials in an agent registration URL.
- Restrict `CORS_ORIGINS` to trusted UI origins.
- Apply tenant-aware authorization before sharing the SQLite registry.
- Replace local SQLite if multiple API replicas need a shared registry.
- Review file URLs before allowing browsers to access private artifact stores.
- Preserve SSE streaming through load balancers and reverse proxies.
- Keep remote invocation timeouts and response limits bounded.

The current remote A2A registry does not attach custom authorization headers.
For authenticated agents, add a server-side credential/interceptor strategy to
the A2A client. Do not send remote-agent credentials to the browser.

## Integration checklist

1. Start Relay and confirm `GET /api/health`.
2. Confirm the browser can reach the same origin's `/api/*` paths.
3. Configure Gemini credentials for coordinator chat.
4. Start the remote A2A agent.
5. Verify its Agent Card independently.
6. Enable private-agent access only when developing locally.
7. Register the base URL.
8. Invoke it directly from the Agents drawer.
9. Ask the coordinator to list and delegate to it.
10. Verify text, structured data, files, and optional A2UI output.
11. Run tests and evaluation before deployment.
12. Add production authentication, HTTPS, shared persistence, and observability.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service and protocol health |
| `POST /api/ag-ui` | AG-UI streaming coordinator endpoint |
| `GET /api/ag-ui/capabilities` | AG-UI capability discovery |
| `GET /api/agents` | List registered A2A agents |
| `POST /api/agents` | Discover and register an A2A agent |
| `DELETE /api/agents/{id}` | Remove an agent from the registry |
| `POST /api/agents/{id}/invoke` | Invoke a registered remote agent |

## Commands

| Command | Purpose |
|---|---|
| `make dev` | Start the React client and ADK API |
| `make api` | Start only the FastAPI/AG-UI service |
| `make web` | Start only the React client |
| `make a2a` | Expose the coordinator over A2A |
| `make playground` | Start the ADK development playground |
| `make inspector` | Start the A2A protocol inspector |
| `make test` | Run deterministic backend and frontend tests |
| `make test-integration` | Call Gemini through the ADK runner |
| `make build-web` | Type-check and build production assets |
| `make eval` | Run the ADK behavioral evaluation |
| `make eval-all` | Run all evaluation sets |
| `make lint` | Run Python formatting, lint, spelling, and type checks |

## Troubleshooting

### The UI opens but agent requests fail

Check both services:

```bash
curl http://localhost:8000/api/health
curl http://localhost:5173/
```

In development, Vite proxies `/api` to port 8000. If only the web process is
running, the interface loads but live agent operations fail.

### Local agent registration is rejected

Set `ALLOW_PRIVATE_AGENTS=true` only in the local environment, restart the API,
and register the base URL again.

### Agent discovery fails

Check DNS, scheme, port, the Agent Card path, the card's declared URL, and
whether Relay can reach every additional interface declared by the card.

### The agent returns data but no custom dashboard

That is valid. Relay displays arbitrary data as a table or JSON inspector. To
create an interactive dashboard, return a direct A2UI surface or A2UI operations.

### Streaming works locally but not through a proxy

Disable response buffering for `/api/ag-ui`, allow `text/event-stream`, and
increase the proxy's streaming idle timeout.

### A remote file does not preview

The file URI must be reachable by the user's browser and must report a useful
MIME type. Use a signed public URL or return bytes when appropriate.

## Safety model

Generated UI is declarative data, never executable JavaScript or HTML. Only the
local component catalog is rendered. Unknown protocol content remains visible
through safe fallbacks instead of being silently discarded.

See [DESIGN_SPEC.md](DESIGN_SPEC.md) for project requirements and safety
constraints.
