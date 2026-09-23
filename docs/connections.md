# Integrating agents and semantic layers

Relay separates the **transport** (how to invoke a service) from the **result renderer** (how to display its output). An agent's framework is irrelevant if it exposes one of the supported contracts. No ADK conversion is required.

## 1. Choose a contract

- **A2A:** discover an agent by its Agent Card and send conversational messages.
- **AG-UI:** connect an existing streaming run endpoint.
- **MCP:** discover tools and their JSON input schemas, then call a selected tool.
- **HTTP:** map a prompt or structured input into an existing GET/POST API.
- **OpenAPI:** import a JSON description and select an operation with generated inputs.
- **Installed adapter:** register trusted discovery/execution functions for any other protocol or an in-process SDK. See [adapter SDK](adapters.md).

For an SDK-only agent, use an in-process adapter (no endpoint needed) or add a small HTTP wrapper around your own invocation method. For a semantic layer, prefer its existing MCP or JSON API; an LLM is not required to display data.

## 2. Start the gateway and configure credentials

Run `make dev` from the repository (Node 24 required). For loopback/private services, use `ALLOW_PRIVATE_AGENTS=true make dev` only in a trusted development environment.

Credentials belong in the gateway process environment. A connection contains only a reference:

```json
"auth": { "env": "SALES_API_TOKEN", "header": "Authorization", "prefix": "Bearer " }
```

For a raw API key use the required header and an empty prefix. Set the value through your secret manager or an ignored environment file, and start the API with `uv run --env-file .env uvicorn app.server:app --port 8000`. Custom variables in a file are not automatically exported by Pydantic Settings. Restart the API after environment changes.

The gateway does not forward these headers across origins. An authenticated A2A card pointing at another origin requires a same-origin gateway/wrapper.

## 3. Register a connection

Open **Connections**, choose the type, supply a name and URL, then **Add connection**. Alternatively paste a manifest into **Import connection manifest**.

A2A/MCP registration performs discovery. OpenAPI registration fetches the description without invoking its operations. HTTP/AG-UI registration validates configuration and network policy but intentionally does not execute a query. “Configured; run to verify” is not a health check. **Refresh** repeats discovery; **Use** selects the service; **Remove** deletes its saved configuration.

API equivalent:

```bash
curl -X POST http://localhost:8000/api/connections \
  -H 'Content-Type: application/json' \
  --data-binary @connection.json
```

The response includes an `id` and discovery metadata. List via `GET /api/connections`, refresh via `POST /api/connections/{id}/discover`, delete via `DELETE /api/connections/{id}`. Configuration editing currently means remove/re-add; it produces a new ID.

### HTTP/JSON: existing FastAPI agent

Suppose your own application exposes this contract:

```python
from fastapi import FastAPI
from pydantic import BaseModel

api = FastAPI()


class Query(BaseModel):
    question: str
    filters: dict = {}


@api.post("/query")
async def query(request: Query):
    # Replace with your agent, semantic-layer client, or application call.
    return {
        "answer": [
            {"kind": "text", "text": f"Results for {request.question}"},
            {"kind": "table", "rows": [{"region": "West", "revenue": 120}]},
        ]
    }
```

Run it on port 9000 and register:

```json
{
  "name": "Existing FastAPI agent",
  "kind": "http",
  "url": "http://localhost:9000/query",
  "http": {
    "method": "POST",
    "body": { "question": "$prompt", "filters": "$input" },
    "response_path": "/answer",
    "input_schema": {
      "type": "object",
      "properties": { "region": { "type": "string" } },
      "additionalProperties": false
    }
  }
}
```

Click **Use**, enter a question and query input, then **Send**. Chat shows text; returned tables/charts also appear on the canvas and dashboard.

Mapping rules:

| Placeholder | Runtime value |
| --- | --- |
| `$prompt` | Current chat prompt |
| `$input` | Structured query/tool argument object |
| `$messages` | Current conversation messages |
| `$threadId` | Client conversation ID |

Placeholders must be complete JSON values, not substrings. Templates recurse through objects and arrays without evaluating code. GET uses query parameters; nested objects/arrays are JSON-encoded. POST sends JSON. Methods other than GET/POST, dynamic URL paths, multipart uploads, and arbitrary scripting are not supported.

`response_path` is an RFC 6901 JSON pointer, e.g. `/data/rows` or `/results/0`; blank preserves the complete response. Missing paths produce a visible error. HTTP responses can be JSON or plain text, not arbitrary binary downloads.

### Semantic-layer example: Cube-style REST query

Cube's documented REST `/load` query pattern can be represented as an HTTP mapping. Use your deployment's actual endpoint, model members, and JWT. This example is **not a live-tested Cube connector**; it illustrates the configurable HTTP adapter. See [Cube's first-party REST integration example](https://cube.dev/blog/building-a-budibase-dashboard-with-cube).

```json
{
  "name": "Sales semantic layer",
  "kind": "http",
  "url": "https://YOUR-CUBE-HOST/cubejs-api/v1/load",
  "auth": { "env": "CUBE_API_TOKEN", "header": "Authorization", "prefix": "" },
  "http": {
    "method": "GET",
    "body": { "query": "$input" },
    "response_path": "/data"
  }
}
```

Query input:

```json
{ "measures": ["Orders.count"], "dimensions": ["Orders.region"] }
```

The adapter serializes this object into the query parameter and renders returned rows. It does not infer semantic models or retry vendor-specific “continue wait” responses. Add a wrapper for asynchronous polling, custom auth refresh, or query translation.

Other semantic layers work the same way **if** they expose compatible JSON/MCP contracts. Otherwise implement a wrapper; naming a vendor is not proof of compatibility.

### MCP: tools and semantic services

Manifest:

```json
{
  "name": "Analytics tools",
  "kind": "mcp",
  "url": "https://analytics.example.com/mcp",
  "auth": { "env": "ANALYTICS_TOKEN" }
}
```

The gateway initializes a Streamable HTTP session, discovers tools (including paginated lists), and saves their input schemas. Select a tool after clicking **Use**. Primitive properties and nested objects become fields; use the JSON editor for arrays, unions and other complex schemas. The gateway rechecks the selected tool and validates arguments against its live schema before calling it.

For a working local MCP 2 example, see [protocol_fixture.py](../examples/protocol_fixture.py). Run:

```bash
uv run uvicorn examples.protocol_fixture:app --port 9101
```

Register `http://localhost:9101/mcp`, select `revenue`, and send `{"region":"West"}`. The same fixture exposes `/query` (HTTP) and `/ag-ui` (AG-UI). These deterministic fixtures do not require a model or API key.

MCP results may include text, image/audio, resource links, embedded resource content, and `structuredContent`. Unknown forms remain JSON. The client does not fetch `mcp://` resources or automatically invoke another tool.

### AG-UI: a streaming agent

```json
{
  "name": "Streaming analyst",
  "kind": "agui",
  "url": "https://agent.example.com/run"
}
```

The endpoint receives a POST with `threadId`, `runId`, `messages`, `state`, `tools`, `context`, and `forwardedProps`. It must emit JSON events in `text/event-stream` SSE frames:

```text
data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Hello"}

data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}

data: {"type":"CUSTOM","name":"relay.result","value":{"kind":"metric","label":"Revenue","value":"$120K"}}

data: {"type":"RUN_FINISHED","threadId":"...","runId":"..."}

```

Native lifecycle, text, tool events, state snapshots, and JSON Patch state deltas are handled. Return arbitrary structured results in a CUSTOM event. Standard error events become visible failures. The gateway wraps runs in a consistent lifecycle.

### A2A: an agent in any framework

```json
{
  "name": "Research specialist",
  "kind": "a2a",
  "url": "https://agent.example.com"
}
```

Supply the **base URL**, not a chat endpoint. The A2A SDK resolves the Agent Card and selects a supported JSON-RPC or HTTP+JSON interface. The current SDK supports 1.x and a 0.3 compatibility layer; the browser contract test uses ADK's current A2A wrapper.

Relay passes the prompt as a user message with a stable conversation context ID. A2A messages, task updates, data parts, and artifacts flow into the result normalizer. Session semantics still depend on the remote server; do not assume its task-resume, approval, or cancellation flows are implemented in this client.

For the deterministic local ADK A2A fixture:

```bash
uv run uvicorn examples.protocol_fixture:a2a_app --port 9102
```

Register `http://localhost:9102`.

## 4. Invoke through the API

All connection types use one run route:

```bash
curl -N -X POST http://localhost:8000/api/connections/CONNECTION_ID/run \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Show revenue","thread_id":"demo","input":{"region":"West"}}'
```

For MCP, add `"tool":"revenue"`. OpenAPI and custom operation adapters use the same `tool` field; OpenAPI write-method requests also require `"confirmed":true`. For AG-UI, optionally pass `messages` and `state`. HTTP maps input through its manifest; A2A currently uses the prompt. The response is AG-UI-shaped SSE: lifecycle events plus native events or `CUSTOM / relay.result`.

The optional ADK coordinator can call `list_connections` and `query_connection`; it sees discovery/schema data, not auth values. Direct UI invocation does not involve this coordinator.

## 5. Return dynamic results

Plain strings and Markdown work. Arrays of records render as tables. Explicit blocks avoid ambiguous inference:

```json
{
  "blocks": [
    { "kind": "markdown", "text": "## Quarterly revenue" },
    { "kind": "metric", "label": "Revenue", "value": "$300K" },
    { "kind": "table", "rows": [{ "quarter": "Q1", "revenue": 120 }] },
    {
      "kind": "chart",
      "title": "Revenue by quarter",
      "xKey": "quarter",
      "yKey": "revenue",
      "data": [{ "quarter": "Q1", "revenue": 120 }, { "quarter": "Q2", "revenue": 180 }]
    },
    { "kind": "image", "url": "https://example.com/plot.png", "name": "Plot" },
    { "kind": "file", "url": "https://example.com/report.pdf", "mimeType": "application/pdf", "name": "Report" }
  ]
}
```

The legacy `chart` block is a simple labeled bar chart. Use `vega-lite` or `vega` specs for richer data graphics, `svg` for bespoke designs, and `dashboard` to compose them—all built in with no per-visual renderer. A custom domain kind may attach a `presentation` instead of registering React code. See [declarative visualization examples](visualizations.md). Unsupported results without a declared presentation remain visible JSON. HTTP envelope metadata is retained when no response pointer discards it; recognized protocol envelopes are normalized into their content blocks.

### Declarative A2UI

New integrations should use the **v1.0 candidate** contract documented in [A2UI v1 integration](a2ui-v1.md). Relay implements all 18 basic components and 14 basic functions, schema validation, bindings/templates, catalog negotiation, structured actions and bidirectional RPC. Versioned v1 actions are delivered as protocol messages, not English follow-up prompts.

The guide includes HTTP, AG-UI, MCP and A2A return-channel mappings. HTTP supports `$a2uiMessages` and `$metadata`; MCP requires an advertised `a2ui_tool`. Services must implement their return channel to make generated controls functional.

Legacy unversioned/v0.9 Relay payloads still use the old compatibility renderer, including its nonstandard extensions and prompt-based actions. That path is not v1 and is not advertised as full v0.9 conformance. Catalog downloads and arbitrary code execution are not supported. See the [protocol audit](protocol-audit.md) for remaining gaps.

### Optional native host renderer

This is optional for embedding native host components; it is no longer necessary for bespoke charts, maps, vector drawings or dashboards. Prefer [declarative visuals](visualizations.md). To deliberately embed a native component, register it from your application's startup module (e.g. `web/src/main.tsx`) before rendering the app:

```tsx
import { registerResultRenderer } from './components/ResultRenderer'

registerResultRenderer('company.geo', ({ block }) => (
  <pre>{JSON.stringify(block.data, null, 2)}</pre>
))
```

Replace the placeholder with your own map/chart/component. A result with `{"kind":"company.geo", ...}` retains the original payload as `block.data`. Without registration or a declarative `presentation`, it displays JSON. This code is bundled by the application owner; agents cannot install modules or execute scripts. Add tests for your renderer and rebuild the client.

A new transport uses `register_adapter(Adapter(...))` at backend startup. The client discovers its label, configuration schema, input capabilities and operations from the gateway. No hardcoded manifest union, client label edit or client rebuild is needed. See [the complete adapter walkthrough](adapters.md).

## Limits and safety

- No multi-user authentication, tenant isolation, role-based connection permissions, generic human-approval workflow, or audit-grade persistence. Do not expose the gateway publicly as-is.
- Connection registration grants outbound access and potential tool execution. Use a trusted operator, least-privilege service tokens, and network egress controls. URL/DNS checks are defense-in-depth, not a complete SSRF sandbox.
- Private addresses are blocked by default and checked again on outgoing requests. Disabling this for local development broadens network access.
- Auth is a single environment-reference header, not OAuth login/refresh, per-user delegation, mTLS, or credential discovery. Anyone authorized to configure the gateway must be trusted to reference its environment credentials.
- HTTP response and forwarded AG-UI stream limits are 8 MiB; result events also have a serialization limit. SDK-managed MCP/A2A buffering is not guaranteed to be capped before parsing.
- Default run timeout is 20 seconds; set `AGENT_TIMEOUT_SECONDS` for slower services. There is no generic automatic retry, polling, or workflow resume.
- Stop cancels the client's request and upstream connection where supported. It does not guarantee rollback or cancellation of a remote task/tool's side effects.
- Browser media requests do not receive gateway auth headers. Return safe public/signed links or supported inline media; links remain subject to browser CORS and content restrictions.
- Threads are in browser memory and ADK coordinator sessions are in process memory; refresh/restart loses them. Connections alone persist in SQLite.
- Use the separate OpenAPI adapter for schema discovery; the HTTP adapter remains an explicit request mapping. Neither infers undocumented business semantics.
- Client fields cover nested objects, primitive properties and enums; arrays/unions and other complex schemas use JSON input. Defaults are not silently submitted.
- Unknown AG-UI custom data stays visible; arbitrary vendor events are not guaranteed a specialized UI.
