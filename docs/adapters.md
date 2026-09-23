# Universal adapter host

Relay's standalone client does not need to know an agent's framework. Transport,
operation schemas and result presentation are separate contracts.

- Existing A2A, AG-UI, MCP or HTTP service: register its connection.
- Existing OpenAPI-described service: import its JSON document and choose an operation.
- Proprietary protocol, local SDK or semantic engine: install a trusted Python adapter.
- Return text, structured data, media or A2UI through the same result pipeline.

"Universal" means extensible through these contracts. It does not mean zero
configuration for undocumented APIs, automatic OAuth, inferred business meaning,
or inferred visual meaning for every opaque value. Agents can supply bespoke visual designs directly through the [declarative visualization contract](visualizations.md).

## OpenAPI: connect an existing FastAPI service

1. Run your service and find its OpenAPI JSON URL (normally `/openapi.json`).
2. Start Relay. For loopback services only, use
   `ALLOW_PRIVATE_AGENTS=true make dev`.
3. Open **Connections**, select **OpenAPI service**, enter a name and document URL.
4. Set an authentication environment-variable reference if required, then add it.
   Registration fetches the document; it does **not** call business operations.
5. Click **Use**, choose an **Operation**, and fill the generated fields.
6. Review the JSON input. Confirm potentially state-changing methods, then **Send**.
   Confirmation clears when input/operation changes and after each submission.

For a local reproducible service:

```bash
uv run uvicorn examples.protocol_fixture:app --port 9101
```

Register:

```json
{
  "name": "Inventory service",
  "kind": "openapi",
  "url": "http://localhost:9101/openapi.json"
}
```

Choose `inventory` and send:

```json
{"path":{"region":"West"},"query":{"limit":17}}
```

Choose `semantic_query`, enter `{"body":{"region":"West"}}`, confirm the POST,
and send. Its text, table and chart render without service-specific UI code.

The API equivalent uses the same connection run route:

```json
{
  "tool": "semantic_query",
  "input": {"body":{"region":"West"}},
  "confirmed": true
}
```

### OpenAPI configuration and boundaries

Supported description versions are 3.0, 3.1 and 3.2, as JSON. This is a
deliberate subset of the [OpenAPI specification](https://spec.openapis.org/oas/v3.2.1.html),
not a conformance claim. Operation IDs are used when supplied; otherwise names
are `METHOD /path`. Duplicate IDs are unavailable, not chosen ambiguously.

- GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS.
- Path, query and non-reserved header parameters, plus JSON request bodies.
- Common query form/explode, flat deepObject and non-exploded array delimiters;
  simple path/header serialization. Nested parameter serialization is rejected.
- Bundled local input references, 3.0 nullable normalization, read-only property
  exclusion, and JSON Schema input validation. Formats are annotations, not
  guaranteed domain validation.
- Root/path/operation server precedence and server-variable defaults.
  Optional `config.server_url` overrides the base URL, **on the same origin**.
- Fresh discovery and validation on every execution. Changed remote schemas can
  reject a saved input; use Refresh to update the client's displayed schema.
- JSON, text and bounded binary responses go through the result pipeline. Safe
  supported media/PDF payloads get native controls; other binary types retain
  inspectable base64 metadata, not an automatic executable preview.
- All non-GET/HEAD/OPTIONS operations need confirmation, even read-only POST
  query APIs. A GET can still have side effects on a badly designed service;
  confirmation is not a security boundary or authorization system.
- Cookies, multipart/form bodies, external/recursive input references,
  dynamic references, unsupported parameter styles and content-encoded
  parameters need a dedicated adapter. Unavailable operations expose a reason.
  Arbitrary response schemas are not compiled or used to execute code.
- YAML, webhooks, callbacks, asynchronous polling, OAuth token exchange,
  automatic retries and the complete 3.2 feature set are not implemented.

Credentials use the existing server environment-header reference. No secrets
belong in the document URL, manifest configuration, browser or schema defaults.
The adapter does not synthesize credentials from OpenAPI security declarations.
Description and operation fetches use guarded HTTP clients, same-origin
execution, no redirects and an 8 MiB response limit. Base64/event overhead can
make the effective binary display limit smaller.

For A2UI return messages, explicitly set
`config.a2ui_operation` to the operation receiving
`{"messages":[...],"metadata":{...}}` as its JSON body. Such UI messages use
that configured channel, not the selected query operation. The host treats that
channel as explicitly enabled interaction; it does not require the separate
query confirmation checkbox. The service remains responsible for authorization
and confirmation of consequential actions.

## Install a custom adapter: no frontend changes

1. Implement async discovery and execution in a trusted Python module.
2. Create an `Adapter` with a unique kind, human label and capabilities.
3. Register it once at startup, in every gateway worker.
4. Restart the gateway. Open Connections again; its type appears automatically.
5. Add a connection with that kind and its schema-validated configuration.
6. Add contract tests for discovery, auth, execution, errors and cancellation.

Minimal registration:

```python
from app.adapters import register_adapter
from my_integration import adapter
from app.server import app

register_adapter(adapter)
# Start this module's app with uvicorn.
```

If hosting in your own FastAPI application, register adapters in your startup
module and include `app.connection_routes.router`. The same standalone client
can point to that host using `VITE_API_BASE_URL`. No coordinator is required.

The runnable [example gateway](../examples/plugin_gateway.py) installs both an
HTTP-envelope adapter and an endpoint-free local-function adapter:

```bash
ALLOW_PRIVATE_AGENTS=true uv run uvicorn examples.plugin_gateway:app --port 8000
npm --prefix web run dev
```

Stop your existing API on port 8000 before using this command, or choose a
different port and update `VITE_API_BASE_URL`. These examples are not installed
in the default production gateway.

For the HTTP adapter, also run the fixture on 9101 and select **Example semantic
adapter** with `http://localhost:9101/query`. It translates the host input into
the vendor envelope, extracts the answer and yields normalized events.

For **Local function adapter**, no URL is needed. Supply x and y; it calls an
in-process function and returns a metric. Optionally expand **Adapter
configuration** and set `{"label":"My total"}`. See
[local_adapter.py](../examples/local_adapter.py); replace its deterministic
function with your actual SDK or semantic engine.

### Adapter contract 1.0

`Adapter` is exported from `app.adapters`:

| Member | Contract |
| --- | --- |
| `kind` | Unique lowercase identifier; built-in names cannot be replaced |
| `label` | Client-visible type label |
| `discover(spec, allow_private, timeout)` | Async function returning discovery metadata |
| `execute(spec, run, allow_private, timeout)` | Async iterator yielding AG-UI-shaped event dictionaries |
| `config_schema` | JSON Schema for manifest `config`; checked before discovery and every run |
| `capabilities` | E.g. `chat`, `operations`, `structuredInput`, `streaming`, `a2ui` |
| `requires_endpoint` | Default true; false for local SDK/function adapters |
| `requires_terminal_event` | Default false; true requires the adapter to emit RUN_FINISHED |
| `contract_version` | Currently exactly `1.0` |

Discovery returns a `verified` boolean, optional `note`, and optional `tools`:

```json
{
  "verified": false,
  "tools": [{
    "name": "query",
    "description": "Query this semantic engine",
    "inputSchema": {
      "type": "object",
      "properties": {"region":{"type":"string"}},
      "required": ["region"]
    }
  }]
}
```

Operations can also advertise `available:false` with a `reason`,
`requiresConfirmation:true`, and `method`. The client exposes these controls;
**your execute function must enforce confirmation and validate input itself**.
Discovery must not invoke consequential business operations.

`ConnectionSpec` contains name, kind, URL, description, config and optional
server auth reference. `RunInput` provides prompt, input, tool, messages,
thread_id, state, a2ui_messages, metadata, task_id and confirmed. Support only
capabilities you actually implement and reject unsupported requests explicitly.

For ordinary values use:

```python
from app.connections import result_event

yield result_event({"rows": [{"region": "West", "revenue": 120}]})
```

For chat streaming yield native text-start/content/end events. For A2UI return
versioned messages via `result_event` and handle `run.a2ui_messages`; see
[the v1 guide](a2ui-v1.md). Unsupported return channels must raise an error,
not pretend that a click succeeded.

The gateway wraps each run with lifecycle events, enforces timeout and
JSON/event limits, and displays safe errors. Raise `ConnectionError` only for
messages safe to expose to the operator. Other exception details are hidden.
Do not swallow cancellation. Offload blocking SDK calls to a thread; cancelling
a request cannot stop arbitrary synchronous code or undo upstream effects.

Use `http_client(spec, allow_private, timeout)` for outbound HTTP so auth,
network validation and redirect restrictions are preserved. Trusted adapters
can execute Python and bypass these helpers: **this is not a code sandbox**.
Never install an adapter based on an untrusted remote manifest. Registration is
server code, not a public upload or module-import endpoint.

`GET /api/connections/adapters` exposes descriptors and the contract version.
The client builds its connection dropdown and operation inputs from these
descriptors. Adding a connection is runtime configuration; installing a new
adapter needs a gateway restart but no frontend rebuild.

## Results and visualization

Built-in normalized results support text/Markdown, records/tables, explicit
metrics and simple bar charts, supported media/files, A2UI and JSON fallback. Vega/Vega-Lite, restricted SVG and dashboard composition now cover bespoke visual designs without client plugins.
Adapters can translate vendor envelopes into these shapes without UI work.
Complex arrays/unions remain editable as JSON; schema defaults are not silently
sent. Generated fields have depth/count bounds, with raw input always available.

A domain-specific result can attach a `presentation` containing a chart spec, SVG or dashboard. The client renders it without knowing the domain kind and retains the original data. See [visualization examples and limits](visualizations.md). No agent-supplied JavaScript or HTML is executed. New native executable components remain an explicit host extension, not something an agent can install.

No particular production vendor has been selected or certified. The automated
fixtures verify the extension mechanics; they do not establish that an
arbitrary vendor's authentication, semantics or workflows are implemented.
