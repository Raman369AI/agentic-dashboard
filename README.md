# Relay — Agentic Dashboard

A standalone universal workspace for Google ADK agents. Relay combines a
streaming chat client, a trusted generative-dashboard canvas, an A2A registry,
and an inspectable activity stream in one repository.

## Included

- Google ADK coordinator using `gemini-3-flash-preview`
- AG-UI SSE endpoint with messages, state, tools, and run lifecycle events
- A2UI v0.9 generation pipeline and allowlisted React renderer
- Remote A2A Agent Card discovery, persistence, invocation, and removal
- Chat, dashboard canvas, run activity, artifacts navigation, and agent drawer
- Responsive desktop/mobile client with a text-only fallback
- SSRF protection and a SQLite local registry
- A separate A2A endpoint so the coordinator is reusable by other clients

## Architecture

```text
web/ React client
  ├─ Chat + streamed AG-UI events
  ├─ A2UI dashboard renderer
  └─ A2A registry management
             │
             ▼
app/server.py (FastAPI + AG-UI adapter)
             │
             ▼
app/agent.py (Google ADK coordinator)
  ├─ local ADK tools
  └─ registered remote A2A agents
```

The browser and agent service are separate applications. The browser can be
deployed as static assets and pointed at any compatible API origin.

## Quick start

Requirements: Python 3.10–3.13, `uv`, Node.js 20+, and `make`.

```bash
cp .env.example .env
# Add GOOGLE_API_KEY to .env, or configure Vertex AI credentials.
make install
make dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:8000`.
The initial workspace renders without credentials; chat requires Gemini access.

## Connect plug-in agents

Open **Agents** and enter the base URL of an A2A-compatible service. Relay
resolves `/.well-known/agent-card.json`, validates the card, and stores it
locally. The coordinator can then discover and delegate to that agent.

Local agent addresses are blocked by default. For local-only development:

```bash
ALLOW_PRIVATE_AGENTS=true make dev
```

Expose Relay's coordinator as an A2A service on port 8001 with `make a2a`.

## Commands

| Command | Purpose |
|---|---|
| `make dev` | Start the standalone web client and ADK API |
| `make api` | Start only the FastAPI/AG-UI service |
| `make web` | Start only the React client |
| `make a2a` | Expose the coordinator over A2A |
| `make test` | Run deterministic backend and frontend tests |
| `make test-integration` | Call Gemini through the ADK runner |
| `make build-web` | Type-check and build production client assets |
| `make eval` | Run the ADK behavioral evaluation |
| `make lint` | Run Python format, lint, spelling, and type checks |

## API surface

- `POST /api/ag-ui` — AG-UI streaming agent endpoint
- `GET /api/ag-ui/capabilities` — capability discovery
- `GET/POST /api/agents` — list or register A2A agents
- `DELETE /api/agents/{id}` — remove an agent
- `POST /api/agents/{id}/invoke` — invoke a remote agent
- `GET /api/health` — service and protocol health

Generated UI is declarative data, never executable code. See
[DESIGN_SPEC.md](DESIGN_SPEC.md) for requirements and safety constraints.
