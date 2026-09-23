# Relay — Agentic Dashboard

A standalone React client for chat, dashboards, and structured results, backed by a FastAPI connection gateway. Google ADK powers the **optional coordinator**; connected services do not have to use ADK.

Connect through **A2A, AG-UI, MCP Streamable HTTP, configurable HTTP/JSON, OpenAPI, or trusted custom adapters**. A semantic layer can connect directly as an API or MCP tool server, or sit behind an agent. Register connections at runtime—no UI rebuild for a new endpoint.

The client is a **universal adapter host**: new agent frameworks, SDKs and semantic engines integrate behind a versioned server contract, without client changes. This is extensibility, not automatic interpretation of undocumented APIs. Agents can supply bespoke visuals as Vega/Vega-Lite specs, restricted SVG or composed dashboards—no per-visual frontend renderer. Unknown data without a declared presentation remains inspectable as JSON.

## Run locally

Requirements: Python 3.11–3.13, [uv](https://docs.astral.sh/uv/), and Node **24.15+ within 24.x**. The development version is pinned in [.node-version](.node-version). Older Node 20 installations are not supported by the upgraded frontend toolchain.

```bash
git clone https://github.com/Raman369AI/agentic-dashboard.git
cd agentic-dashboard
# If using nvm: nvm install && nvm use
uv sync --locked
npm --prefix web ci
make dev
```

Open http://localhost:5173. API docs: http://localhost:8000/docs.

No model key is required to add or run direct connections. The default coordinator does require Gemini credentials; open **Connections**, add your endpoint, and click **Use** to bypass it.

For local/private services, start the API with `ALLOW_PRIVATE_AGENTS=true`. This is a development-only relaxation of outbound network checks:

```bash
ALLOW_PRIVATE_AGENTS=true make dev
```

For optional coordinator chat, copy [.env.example](.env.example) to an ignored `.env`, configure AI Studio or Vertex AI, then run the API with `uv run --env-file .env uvicorn app.server:app --port 8000 --reload` and the UI with `npm --prefix web run dev`. Remote-service credential variables must also be exported or loaded into the API process with `--env-file`; never put secrets in `VITE_*` variables.

## Connect your agent or semantic layer

| Service exposes | Choose | Configuration |
| --- | --- | --- |
| A2A Agent Card | A2A agent | Base URL; the SDK discovers advertised interfaces |
| AG-UI run endpoint | AG-UI agent | POST endpoint accepting AG-UI run input and SSE events |
| MCP tools | MCP tools / semantic layer | Streamable HTTP endpoint; tool schemas are discovered |
| JSON or text API | HTTP / semantic API | GET/POST URL, request mapping, optional response pointer and input schema |
| OpenAPI JSON document | OpenAPI service | Document URL; discover operations and parameter/body schemas |
| Proprietary protocol or SDK-only agent | Installed adapter | Register trusted Python discovery/execution functions; endpoint optional |

The UI supports form entry and JSON manifest import. Operation schemas produce nested object fields, primitives and enums; a JSON editor handles arrays, unions and other complex inputs. Credentials are referenced by server environment-variable name, not stored in the registry.

See [the adapter SDK and OpenAPI walkthrough](docs/adapters.md) for endpoint and in-process integrations, exact contracts, examples and limits. New server adapters appear in the client automatically; bespoke visual designs use the built-in declarative formats described in the [visualization guide](docs/visualizations.md).

See [detailed integration instructions](docs/connections.md) for runnable examples, manifests, semantic-layer mappings, authentication, custom renderers, and protocol limits.

## Client and results

Chat, dashboard/canvas, runs, artifacts, activity, and connection management share the same client. Results are normalized independently of which framework produced them:

- Text and safe Markdown; tables from rows; explicit metrics and simple bar-chart blocks.
- Vega/Vega-Lite charts and inline-data maps, restricted SVG designs, dashboard composition, and generated range/select/checkbox controls. No client plugins needed for new visual designs.
- Image, audio, video, and file links when supplied through a supported URL or media payload.
- A2A messages/artifacts, MCP content and structured content, AG-UI text/state/tool/custom events.
- A2UI v1 candidate surfaces: all 18 basic components, bindings, validation, structured actions and bidirectional function calls.
- JSON fallback for unknown data, and a per-result error boundary for rendering failures.

The [A2UI v1 guide](docs/a2ui-v1.md) includes a runnable form agent, return-channel mappings, catalog extensions and safety boundaries. The [protocol audit](docs/protocol-audit.md) lists what was corrected and what remains unsupported.

Bespoke declarative visuals require no custom renderer or frontend rebuild; agents describe them as data. The gateway exposes the contract at `/api/connections/visualizations`. Trusted client modules can still register optional native components. Agent-generated HTML or JavaScript is never executed. Selecting a local file previews it; it does **not** upload it to a remote agent.

## Standalone or inside your existing FastAPI application

Both are supported.

**Separate client:** deploy `web/dist` on a static host. Set `VITE_API_BASE_URL` at build time to the gateway URL, and configure `CORS_ORIGINS` on the API. Omit the setting if a reverse proxy serves `/api` on the same origin.

```bash
VITE_API_BASE_URL=https://api.example.com npm --prefix web run build
```

**Same FastAPI process:** install this project into your application's Python environment, mount its API, and optionally serve the built UI. Example:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.server import app as relay_api

app = FastAPI()
# Register your own API routes first.
app.mount("/relay", relay_api)
# Use an absolute path to this repository's web/dist in your application.
app.mount(
    "/dashboard",
    StaticFiles(directory="/path/to/agentic-dashboard/web/dist", html=True),
)
```

Build for these paths:

```bash
VITE_API_BASE_URL=/relay npm --prefix web run build -- --base=/dashboard/
```

Visit `/dashboard/`. Requests go to `/relay/api/...`. If your application already has an `app` Python package, avoid the package-name collision: use a separate gateway process with reverse proxying, or relocate the Relay package and update its imports.

**Use only the gateway routes:** include `app.connection_routes.router` in your FastAPI app. That provides direct connections but not `/api/ag-ui` (the optional ADK coordinator) or `/api/health`; add those only if wanted. Authentication, tenancy, lifecycle, and deployment remain your host application's responsibility.

## Compatibility and upgrades

The previous ADK/A2A major-version caps and older Vite/Vitest toolchain were replaced. See the [dated dependency audit](docs/dependencies.md) for resolved versions, sources, and explicit compatibility decisions. TypeScript is deliberately on 6.0.3 because the current lint tooling's peer range does not support 7.x.

Lockfiles are committed; use `uv sync --locked` and `npm ci`. Dependabot is configured for weekly npm and uv checks.

Existing SQLite A2A registrations are imported once into Connections without deleting the legacy registry. The old `/api/agents` routes remain for compatibility; use `/api/connections` for new integrations. Registry state lives in ignored `data/dashboard.db`.

## Verification

```bash
uv run --extra lint pytest tests/unit -q
uv run --extra lint ruff check .
uv run --extra lint ruff format . --check
uv run --extra lint ty check .
npm --prefix web test
npm --prefix web run lint
npm --prefix web run build
cd web
npx playwright install chromium
npm run test:e2e
# Also verify the built client and its bundled workers:
RELAY_E2E_PREVIEW=1 npm run test:e2e
```

The browser suite starts deterministic HTTP, MCP, AG-UI, and real ADK/A2A fixtures. It also discovers OpenAPI operations and independently registered HTTP and in-process adapters, then verifies generated inputs and results **without model credentials**. Additional HTTP/AG-UI tests exercise v1 forms, remote functions, regex validation, submission, and deletion. The visualization workflow exercises a live chart parameter, an unknown vendor's SVG presentation and safety rejection. See [examples/protocol_fixture.py](examples/protocol_fixture.py).

With Gemini credentials, `make eval` runs coordinator tool-trajectory and response-quality evaluations. `make test-integration` also makes a live model call.

## Important limits

This is a single-operator development workspace, **not an authenticated multi-tenant product**. Put it behind your application's auth and authorization before sharing it. Connections can invoke tools that change external state; connect only services whose permissions you intend to grant. OpenAPI write-method operations require a per-run confirmation, but this is not a generic authorization or approval workflow for every protocol.

OpenAPI supports a documented JSON/parameter subset, not every specification feature. MCP currently supports tools over Streamable HTTP, not stdio, legacy SSE, resources/prompts browsing, or OAuth flows. A2A supports the SDK's JSON-RPC and HTTP+JSON bindings, not gRPC. A2UI targets the pinned **v1.0 candidate**, using Relay's schema-validated runtime; it is not upstream-certified or universally vendor-tested. The older unversioned/v0.9 compatibility renderer remains separate. See the [integration guide](docs/connections.md#limits-and-safety) for details, including timeouts, cancellation, media authentication, and session persistence.
