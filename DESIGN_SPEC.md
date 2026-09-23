# Agentic Dashboard — Design Specification

## Declarative bespoke visuals

Render new visual designs without installing a client component: bundled Vega/Vega-Lite, restricted SVG, and composable dashboard blocks. Run chart computation in cancellable workers with interpreted expressions, inline data only and no remote loading. Preserve errors and original specifications. Expose explicit bound-signal controls; use A2UI for agent-side business actions. Never execute agent-supplied JavaScript or HTML.

## Universal extension architecture

Add a versioned, trusted server adapter registry exposed through discovery to the standalone client. New adapter kinds must not require frontend code changes. Add OpenAPI operation discovery and schema-driven inputs with explicit unsupported-operation diagnostics, guarded network access, and no automatic execution during discovery. Preserve opaque results as inspectable data and route operations explicitly; never infer permission for business side effects.

## Revised scope (2026-09-18)

Relay is a standalone, framework-independent client for chat, dashboards, and data results. A FastAPI gateway handles runtime connections; Google ADK supplies an optional coordinator. An external agent or semantic service does not need to adopt ADK or A2UI.

The earlier A2A-only registry did not satisfy the plug-in requirement. The revised boundary is explicit protocol compatibility, not an unqualified promise to invoke every API.

## Architecture

- React/Vite client: conversation, result canvas/dashboard, run activity, media/artifacts, and connection management.
- Connection manifests: name, protocol kind, endpoint, optional credential reference, and optional HTTP mapping/input schema.
- Gateway adapters: A2A JSON-RPC/HTTP+JSON, AG-UI SSE, MCP Streamable HTTP tools, HTTP GET/POST JSON/text.
- Discovery: A2A Agent Cards and MCP tools/schemas. HTTP/AG-UI configuration is not reported as live health.
- Runtime execution: common SSE lifecycle with native AG-UI events or normalized result events.
- Rendering: text/Markdown, rows/tables, explicit metrics/bar charts, safe media links, local A2UI catalog, and JSON fallback.
- Extension: declarative Vega/Vega-Lite, SVG and composed visual blocks need no application renderer registration; native host components can optionally register by kind. New transports require a tested backend adapter.
- Persistence: SQLite connection configuration, one-time non-destructive import of legacy A2A registrations. Browser threads and ADK sessions remain in memory.

## User workflows

1. Register a remote service using a form or JSON manifest.
2. Discover MCP tool inputs or supply an HTTP schema and request mapping.
3. Select the service and send a prompt or structured query without coordinator credentials.
4. Display streamed text and heterogeneous results in the same workspace.
5. Optionally let the ADK coordinator discover and query registered services.
6. Run the UI separately, behind a same-origin proxy, or mount API/static assets in an existing FastAPI application.

## Safety and explicit limits

No agent-generated JavaScript/HTML execution, dynamic dependency installation, or downloaded A2UI catalogs. Unknown and malformed render payloads remain inspectable. Credential values are server-side environment variables, never browser configuration or persisted auth values. Outgoing URLs are checked and private addresses disabled by default; egress policy is still required for production.

This is a single-operator prototype, not an authenticated multi-tenant service. Remote tools may perform writes: there is no universal approval or rollback protocol. Cancellation closes local requests but cannot guarantee remote task rollback. Response/time limits are documented; SDK buffering is not a comprehensive memory sandbox.

Executable visualization plugins, OAuth flows, MCP stdio/resources/prompts, arbitrary undocumented API inference, polling workflows, and persistence of conversations are outside this delivery. Detailed constraints live in docs/connections.md.

## Acceptance criteria

- Current compatible dependency versions and committed lockfiles, with any non-latest choice explained.
- A standalone client that can target a separately hosted API.
- Real browser registration/invocation tests for HTTP, MCP, AG-UI, and ADK/A2A, without a model key.
- HTTP typed mapping/JSON pointers, nested GET query serialization, MCP discovery/schema validation, auth-reference safety, URL policy, and legacy migration covered by backend tests.
- Incremental A2UI updates, typed/unknown output, SSE framing, safe URLs, and renderer failures covered by client tests.
- Backend tests, client tests, lint/type checks, production builds, and browser contract test pass.
- ADK coordinator evaluations preserve the configured Gemini model, test discovered services and grounded status, and report results separately from deterministic protocol tests.
- README and integration guide distinguish tested capabilities from integration examples and production gaps.

No cloud deployment is authorized by this specification.

## A2UI v1 correction

Implement the pinned v1.0 candidate wire schemas, all 18 Basic Catalog components and 14 catalog functions plus @index, atomic ordered updates, JSON pointers, scoped templates, validation, accessibility, mixed catalogs, capability/data-model metadata, structured actions, bidirectional RPC, caller boundaries, errors and lifecycle cleanup. Test upstream schema fixtures separately from runtime/DOM/transport behavior. Do not claim full conformance from schema tests alone. Audit other advertised protocols and document exact omissions. Preserve the existing configured Gemini model.
