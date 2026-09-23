# Protocol implementation audit — 2026-09-18

This separates package upgrades from protocol implementation. A newer dependency
does not automatically implement every feature of its protocol.

| Area | Previous gap | Correction in this revision | Still outside the implemented contract |
| --- | --- | --- | --- |
| A2UI | Custom 0.9-like components, no strict catalog runtime; actions became prompts | Pinned v1 candidate schemas; 18 basic components, 14 functions, binding/templates/checks, catalog resolution, structured actions, bidirectional RPC, metadata and lifecycle | Not upstream-certified; no automatic download of arbitrary vendor catalogs; custom components need trusted registration; no claim that every behavioral edge case or vendor is verified |
| ADK UI bridge | ag-ui-adk's older A2UI auto-injection | Explicit v1 catalog/render tools and structured-action/RPC bridge; existing model preserved | Updated live model behavior evaluation awaits approval; delegated sub-agent UI ownership is not automatically proxied; no claim of fresh model-eval success |
| A2A | Old SDK major, absent UI extension binding | SDK 1.1.4; protobuf messages; native A2UI data-part arrays, extension URI and metadata; API accepts task_id | No gRPC, push notifications, automatic reconnect/poll/resubscribe; UI does not provide a task-resume workflow or guarantee upstream cancellation |
| AG-UI | Partial event consumer and no typed UI return channel | Protocol package 1.0.0; streaming text/tool/state/custom rendering plus v1 forwardedProps contract | Not a complete AG-UI reference client: no generalized tool-approval/resumption UI, durable conversations, or full specialized rendering for every event family |
| MCP | Tool-only integration, older transitive SDK | Explicit MCP 2.2.0; paginated discovery, schema-driven query input, Streamable HTTP, structured output and explicit A2UI return tool with request metadata | No resource/prompt browser, stdio, legacy SSE, OAuth/elicitation UI or generic approval workflow |
| HTTP / semantic layers | Bespoke assumptions and no event mapping | Typed request mapping, input schema, response pointer, auth environment references; explicit UI-message/metadata placeholders | No automatic interpretation of arbitrary proprietary semantics; HTTP mappings remain explicit |
| Extensible adapters / OpenAPI | Fixed transport kinds and no schema import | Versioned registry, dynamically discovered client forms, optional endpoint for in-process SDKs; OpenAPI JSON operation discovery and execution with confirmation | OpenAPI subset only; unsupported operations report reasons; no automatic vendor authentication, recursive input schemas, multipart or workflow inference |
| Client results | Static output assumptions | Framework-independent normalization, incremental surfaces, media/table/chart blocks, Vega/Vega-Lite workers, restricted SVG, declarative dashboard composition and domain presentation envelopes | No arbitrary JS/HTML; no automatic visual semantics for opaque data; chart view supports bound controls rather than pointer-event interactions |
| Sessions/security | Single user/process memory | Data-model synchronization is connection-scoped; secret references and existing network protections retained | Not authenticated multi-tenancy; no durable chat/run store, per-user OAuth, transactional rollback, or audited human approval |

## Evidence, not labels

The new schema suite exercises the pinned upstream v1 fixtures. Runtime/component
tests separately cover bindings, validation, all basic components, permission
boundaries, atomic updates, owner isolation and RPC behavior. Browser tests
exercise HTTP/AG-UI UI round trips and the four-protocol connection workflow.
A2A/MCP v1 binding has backend contract tests; these are not a substitute for
testing a particular production agent.

See [verification.md](verification.md) for executed checks and the blocked live
evaluation. See [dependencies.md](dependencies.md) for resolved dependency
versions and compatibility exceptions.

## Remaining integration decision

No first vendor/service has been selected, by request. Generic contract support
continues independently. A real integration will still need that service's URL,
authentication and protocol/semantic contract; this is configuration, not an
invitation for the agent to infer or obtain credentials.
