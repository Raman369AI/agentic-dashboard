# A2UI v1 integration

## Version and implementation

Relay targets **A2UI v1.0 candidate**, pinned to upstream commit
`04e6f07fde12ff2638b3b489bd9e3033066cb957`. This is a candidate, not a claim
that v1 is production-stable. The [upstream site](https://a2ui.org/) identifies
the release tracks; the [pinned specification](https://github.com/a2ui-project/a2ui/tree/04e6f07fde12ff2638b3b489bd9e3033066cb957/specification/v1_0)
is the implementation reference.

This is Relay's React runtime, **not** the official React renderer relabeled as
v1. At the audit date, published `@a2ui/react@0.11.1` and
`@a2ui/web_core@0.11.0` export the older v0.8/v0.9 runtimes. Package version,
wire version, and production maturity are different things.

Vendored schemas, license and provenance are in `app/a2ui_schema/`. Upstream
schema fixtures are in `web/src/a2ui/fixtures/`. The basic catalog ID is:

```text
https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json
```

## Implemented runtime

- Six inbound operations: createSurface, updateComponents, updateDataModel,
  deleteSurface, callRendererFunction, agentFunctionResponse.
- Strict versioned envelopes and catalog schemas; atomic component updates,
  ordered batches that continue after invalid messages, progressive child
  references, cycle checks and composition constraints.
- JSON-pointer bindings, escaped keys, scoped collection templates, @index,
  nested formatString expressions, reactive updates and two-way bound inputs.
- All 18 basic components: Text, Image, Icon, Video, AudioPlayer, Row, Column,
  List, Card, Tabs, Divider, Modal, Button, CheckBox, TextField, DateTimeInput,
  ChoicePicker and Slider.
- All 14 basic functions: required, regex, length, numeric, email, formatString,
  formatNumber, formatCurrency, formatDate, pluralize, openUrl, and, or, not.
- Validation results and pending checks; accessibility labels, descriptions,
  live regions, native controls, keyboard tabs and native modal dialogs.
- Negotiated catalog IDs, per-component/per-function catalog overrides,
  metadata get/set/change subscriptions, per-agent data-model synchronization.
- Structured actions; bidirectional, correlated RPC; timeouts, caller permissions,
  user-activation boundaries, typed return checks, and surface/session cleanup.
- Trusted custom catalog/component/function registration. Unknown catalogs are
  rejected; catalog URLs never trigger downloads or execute agent-supplied code.

This list describes implemented behavior, not an upstream certification. Passing
schema fixtures does not establish every behavioral edge case or interoperability
with every vendor. See [verification](verification.md) and [remaining gaps](protocol-audit.md).

## Connect an ordinary agent

An agent does not have to generate A2UI. Return text, rows, supported media or
JSON and the generic renderer will display it. To create an interactive UI, the
agent must also implement the return channel below. Merely changing a protocol
label cannot give an existing proprietary agent that behavior.

For HTTP, register this manifest in Connections → Import connection manifest:

```json
{
  "name": "My form agent",
  "kind": "http",
  "url": "http://127.0.0.1:9101/a2ui/http",
  "http": {
    "method": "POST",
    "body": {
      "prompt": "$prompt",
      "input": "$input",
      "messages": "$a2uiMessages",
      "metadata": "$metadata",
      "threadId": "$threadId"
    },
    "response_path": ""
  }
}
```

Use `ALLOW_PRIVATE_AGENTS=true` only for local development. Start the included
no-model example with:

```bash
uv run uvicorn examples.protocol_fixture:app --host 127.0.0.1 --port 9101
```

Select the connection, enter a prompt, and run it. The example renders a form,
a scoped list and a remotely computed greeting. Submit updates the existing
surface; Delete surface removes it. No Gemini credentials are needed.

### First response: create a bound form

```json
{
  "a2ui_messages": [{
    "version": "v1.0",
    "createSurface": {
      "surfaceId": "unique-form-id",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
      "sendDataModel": true,
      "dataModel": {"name": ""},
      "components": [
        {"id": "root", "component": "Column", "children": ["name", "submit"]},
        {"id": "name", "component": "TextField", "label": "Name", "value": {"path": "/name"}},
        {
          "id": "submit", "component": "Button", "child": "submitLabel",
          "checks": [{"condition": {"call": "required", "args": {"value": {"path": "/name"}}}}],
          "action": {"event": {"name": "save", "context": {"name": {"path": "/name"}}}}
        },
        {"id": "submitLabel", "component": "Text", "text": "Save"}
      ]
    }
  }]
}
```

Choose globally unique surface IDs. Do not send createSurface again to update
the same surface. Use updateComponents or updateDataModel. Component updates
replace a component's definition by ID; they do not merge its properties.

Use bound values for editable controls. A literal value has no writable model
path. Collections use `children: {"path": "/items", "componentId": "item"}`;
relative paths in the repeated component resolve under the current item.

### Return message: handle the action

The HTTP endpoint receives `messages` containing the actual protocol message:

```json
{
  "version": "v1.0",
  "action": {
    "name": "save",
    "surfaceId": "unique-form-id",
    "sourceComponentId": "submit",
    "timestamp": "2026-09-18T12:00:00.000Z",
    "context": {"name": "Grace"}
  }
}
```

Validate the action and apply your own authorization/confirmation policy before
performing external writes. Then return, for example:

```json
{
  "a2ui_messages": [{
    "version": "v1.0",
    "updateDataModel": {
      "surfaceId": "unique-form-id",
      "path": "/name",
      "value": "Grace — saved"
    }
  }]
}
```

Every query, action and function message carries `metadata.a2uiRendererCapabilities`.
When a surface opts into sendDataModel, metadata also contains
`a2uiRendererDataModel: {"version":"v1.0","surfaces":{...}}`, scoped to the
originating connection. The HTTP mapping must include `$metadata` to preserve it.
Surface data may contain user-entered sensitive information: opt in deliberately.

The HTTP return path requires an explicit `$a2uiMessages` placeholder.
Query-only input-schema requirements do not run against UI event requests.
Errors are surfaced if no return channel is configured; v1 actions are not
silently converted to English chat prompts.

For end-to-end ownership of a remote agent's UI, select that connection directly.
The coordinator's query/delegation tools do not automatically turn arbitrary
sub-agent surfaces into independently routed UI sessions; the coordinating agent
must handle forwarded actions itself.

## Other transports

| Connection | Agent receives | Agent returns |
| --- | --- | --- |
| AG-UI | `forwardedProps.a2uiMessages` and `forwardedProps.metadata` in RunAgentInput | CUSTOM event with the message array as `value` |
| A2A | Part.data array with `metadata.mimeType: application/a2ui+json`; capabilities/data model in Message.metadata | Equivalent A2UI data parts in messages/artifacts |
| MCP | Configured tool arguments `{"messages":[...]}`; capability/data-model metadata in request `_meta` | structuredContent containing `{"a2ui_messages":[...]}` |
| HTTP | Your mapped `$a2uiMessages` and `$metadata` fields | Message array or `a2ui_messages` envelope |

The A2A adapter sends extension URI
`https://a2ui.org/a2a-extension/a2ui/v1.0` in Message.extensions and the
A2A-Extensions header. The peer must implement that extension. It does not gain
A2UI support merely by implementing ordinary A2A text messages. SDK-level native
data-part serialization is contract-tested; the browser's full interactive v1
round-trip tests currently cover HTTP and AG-UI.

For MCP, set `a2ui_tool` in the manifest or the optional return-channel field:

```json
{
  "name": "Semantic agent",
  "kind": "mcp",
  "url": "https://service.example.com/mcp",
  "a2ui_tool": "handle_a2ui"
}
```

That tool must be advertised by the server and accept a messages array.
Registration does not invent the tool. Normal MCP queries still use the selected
query tool, and the SDK validates the return tool's advertised input schema.
Equivalent JSON duplicated in structuredContent and text content is rendered once.

## ADK coordinator

The coordinator uses `get_a2ui_catalog` and `render_a2ui_v1`, not the older
ag-ui-adk auto-injection helper. `render_a2ui_v1` validates model-generated
messages against the pinned basic schema before returning them. Its model has
not been changed.

`A2UIADKAgent` handles v1 messages in forwardedProps. It presents validated action
objects to the ADK model as JSON and exposes current metadata in session state;
it does not fabricate a conversational "UI action: ..." prompt in the browser.
RPC calls go to a trusted server-side function registry, not an LLM guess:

```python
from app.a2ui_adk import register_agent_function


def lookup_account(account_id: str) -> dict:
    return {"id": account_id, "status": "example"}


register_agent_function(
    "https://your-company.example/catalog/v1", "lookupAccount", lookup_account
)
```

Register at server startup and declare the function in the catalog negotiated
with the client. Unknown functions return a correlated UNKNOWN_FUNCTION error.
Your handlers own argument/business validation and authorization.

## Custom catalogs and components

Register trusted modules before mounting React, for example in `web/src/main.tsx`:

```tsx
import { registerA2UICatalog } from './a2ui/runtime'
import { registerA2UIComponent } from './a2ui/A2UIRenderer'
import catalog from './company-catalog.json'

registerA2UICatalog({
  definition: catalog,
  functions: {
    double: ({ value }) => Number(value) * 2,
  },
})
registerA2UIComponent(catalog.catalogId, 'CompanyMetric', ({ props }) => (
  <section aria-label={String(props.label)}>{String(props.value)}</section>
))
```

The catalog must conform to the pinned catalog_definition.json and declare
protocolVersion "1.0", catalogId, component schemas, function schemas and
return types. Keep its $defs references consistent with its definitions.

Declare allowedCallers explicitly for agent-callable functions. In the pinned
candidate schema, also write `requiresUserActivation: false` explicitly for
agentOnly/rendererOrAgent: its conditional schema otherwise treats the missing
property as matching the activation branch. Activation-requiring functions must
remain rendererOnly.

A component's catalog override does **not** change the default catalog for
functions inside it. Function lookup uses the function's explicit catalogId,
then the surface default. No fallback to the first advertised catalog occurs.

Remote function calls are correlated by functionCallId and resolve only for the
originating agent. Agent calls into the renderer require an explicit catalogId
and an allowed local implementation. openUrl is never remotely callable and
accepts only HTTP(S) navigation during a real user gesture.

## Safety and deployment notes

- No dynamic catalog download, eval, raw HTML, script injection or module install.
- Regex checks run in terminable Web Workers with input limits and a 200 ms
  deadline. A restrictive host CSP must allow the bundled worker.
- Default RPC timeout: 20 seconds. Limits: 64 live surfaces, 2,000 components per
  surface, bounded expression/schema traversal and invocation cache.
- Gateway UI-message batches: at most 100 messages / 1 MiB. General response
  limits remain documented in connections.md.
- Legacy unversioned/v0.9 Relay surfaces use a separate compatibility renderer.
  Its old extensions and prompt-based actions are not described as v1 conformance.
- Sessions are transient. Security, tenant isolation, durable task resumption and
  approval policies are host responsibilities, not supplied by the UI protocol.
