# Bespoke visuals without client plugins

Agents describe the visual, and the standalone client renders it. No React
component, renderer registration or frontend rebuild is needed for a new chart,
diagram, vector illustration, inline-data map or composed dashboard.

Use one of the built-in declarative result blocks:

| Kind | Payload | Use |
| --- | --- | --- |
| `vega-lite` | `spec` object | Charts, layers, facets, statistical plots and geographic marks |
| `vega` | `spec` object | Lower-level custom marks, scales, layouts and transforms |
| `svg` | `svg` string | Bespoke geometry, diagrams, floor plans, illustrations and visual cards |
| `dashboard` | `children` array | Compose these with metrics, tables, text, media and A2UI results |

The old `chart` block still works for simple bars. These newer blocks are not
limited to a predefined list of business chart types.

## Discover the contract

`GET /api/connections/visualizations` returns format descriptions, examples,
engine versions, supported controls and safety limits. An agent, SDK adapter or
semantic layer can read it without assuming a particular agent framework.

The engines are bundled, not loaded from a CDN: Vega **6.4.0**, Vega-Lite
**6.4.3**, and the Vega expression interpreter **2.3.2**. Versions were checked
against npm when implemented. See the [Vega-Lite grammar](https://vega.github.io/vega-lite/)
and [Vega documentation](https://vega.github.io/vega/docs/).

A description does not infer the intended visual from arbitrary opaque data.
The producing agent supplies a spec/SVG, just as it supplies text or A2UI.
It does not need to supply executable rendering code.

## Return a chart from any service

Return this JSON from HTTP/OpenAPI, inside MCP structured content, in an A2A
data part, or as an AG-UI CUSTOM event value:

```json
{
  "kind": "vega-lite",
  "title": "Revenue trend",
  "spec": {
    "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
    "width": 420,
    "height": 220,
    "data": {
      "values": [
        {"month": "Jan", "revenue": 20},
        {"month": "Feb", "revenue": 60},
        {"month": "Mar", "revenue": 90}
      ]
    },
    "mark": {"type": "line", "point": true},
    "encoding": {
      "x": {"field": "month", "type": "ordinal", "sort": null},
      "y": {"field": "revenue", "type": "quantitative"}
    }
  }
}
```

A native spec with a Vega/Vega-Lite `$schema` URL is also recognized. The schema
URL is an identifier; it is not fetched. MIME data envelopes
`application/vnd.vega.v6+json` and `application/vnd.vegalite.v6+json` are
recognized when their spec is in `data`.

For a custom adapter, wrap any of these values with
`yield result_event(value)`. A connected HTTP endpoint needs no Relay imports.

### Working local parameter controls

Add value parameters and a transform to the spec above:

```json
{
  "params": [{
    "name": "minimum",
    "value": 0,
    "bind": {
      "input": "range",
      "name": "Minimum revenue",
      "min": 0,
      "max": 100,
      "step": 10
    }
  }],
  "transform": [{"filter": "datum.revenue >= minimum"}]
}
```

The client generates the slider and recomputes the visual when its value changes.
`select` with scalar `options` and `checkbox` bindings also work. Initial
values must match the control. For Vega use top-level `signals` instead of
Vega-Lite `params`. These controls update the local visual; they do not invoke
a remote agent or mutate service data.

Rendering produces passive SVG snapshots. Pointer brushing, click selection,
hover-event pipelines and arbitrary DOM event bindings are not implemented by
this worker view. Root selection/event parameters are rejected with a diagnostic;
do not send interactive specifications expecting pointer interactions. Use bound
value controls for local filtering and A2UI for forms, buttons and typed remote
actions. This is not a full interactive Vega reference client.

## Return a genuinely bespoke design

For example, an agent can draw a service topology with SVG geometry and text:

```json
{
  "kind": "svg",
  "title": "Agent topology",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 320 100\"><path d=\"M95 50H225\" stroke=\"#7770ee\" stroke-width=\"4\"/><rect x=\"5\" y=\"20\" width=\"90\" height=\"60\" rx=\"12\" fill=\"#5750cc\"/><circle cx=\"265\" cy=\"50\" r=\"40\" fill=\"#087f70\"/><text x=\"50\" y=\"55\" text-anchor=\"middle\" fill=\"white\">Agent</text><text x=\"265\" y=\"55\" text-anchor=\"middle\" fill=\"white\">Data</text></svg>"
}
```

This is a drawing, not a named component that someone must implement first.
SVG text envelopes with `mimeType: "image/svg+xml"` are also accepted.

Supported SVG elements are `svg`, `g`, `path`, `rect`, `circle`,
`ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `title`,
`desc`, `defs`, `clipPath`, `mask`, gradients/stops, patterns and markers.
Presentation attributes are allowlisted. Paint/clip references must be local,
such as `url(#gradient)`. Use inline presentation attributes, not CSS styles.

SVG is rebuilt from the allowlist and displayed only as an image, never inserted
as agent-authored DOM. Scripts, event attributes, `foreignObject`, stylesheets,
external images/links, `use`, animation, XML entities and processing instructions
are rejected. Rejected content produces an error with the original source,
not a silently altered picture.

Each rendered visual has **Download SVG** and **Visualization source** controls.

### Keep a domain-specific result type

A vendor can keep its own payload and attach a portable presentation:

```json
{
  "kind": "factory.floorplan",
  "machines": [{"id": "press-1", "status": "ready"}],
  "presentation": {
    "kind": "svg",
    "title": "Factory layout",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 60\"><rect x=\"10\" y=\"10\" width=\"100\" height=\"40\" rx=\"8\" fill=\"#087f70\"/></svg>"
  }
}
```

The client does not know `factory.floorplan` and does not need to. It renders
the declared presentation and retains the full domain payload in the source
inspector. Presentations may use any of the four built-in visual kinds.

## Compose a dashboard

```json
{
  "kind": "dashboard",
  "title": "Operations",
  "columns": 2,
  "children": [
    {"kind": "metric", "label": "Active agents", "value": 12},
    {"kind": "table", "rows": [{"service": "Sales", "status": "Ready"}]},
    {"kind": "markdown", "text": "## Summary\nAll services responding."}
  ]
}
```

Replace or extend these children with chart, SVG or A2UI results. Layouts use
1–6 columns, collapse on narrow screens and allow at most 24 children per
dashboard with a nesting bound. Invalid children fail independently. New results
from a service append new visuals through the existing result flow; local bound
controls recompute the displayed chart. A2UI retains its separate surface-update lifecycle.

## Safety and resource limits

- Inline data only. External URL/href fields are rejected, and all Vega loader
  entrypoints deny I/O. Fetch authenticated data through the gateway/service
  first, then include it in the spec. Inline GeoJSON works without map downloads.
- Expressions use Vega's [AST interpreter](https://vega.github.io/vega/usage/interpreter/),
  not JavaScript source evaluation. No agent JS, HTML, remote modules, plugins or
  CDN dependencies execute.
- Computation runs in a Web Worker: at most two concurrent renders, bounded
  queue, 8-second timeout, cancellation on input change/unmount, termination on
  completion. Workers do not have DOM access. These bounds are not a hard
  browser heap quota or certification against every computational denial of service.
- Specs and rendered SVG are capped at 2 MiB; spec traversal has depth/node
  limits and SVG has a 10,000-element limit. Dimensions over 4096 are rejected.
- Input changes are debounced and stale worker results cannot replace newer ones.
  The heavyweight chart bundle is loaded only when a chart is needed.
- Browser deployment policies must permit same-origin module workers and
  `data:` images. Downloaded SVG remains passive and allowlisted.
- Return agent-side business interactions as A2UI, not embedded scripts.
  There is no remote side-effect permission implied by a visualization control.

The optional trusted renderer registration API remains for host applications
that intentionally embed native components, but it is **not required** for
bespoke declarative visual designs.

## Runnable proof

Start the protocol fixture, then connect its `/visuals` endpoint as HTTP:

```bash
uv run uvicorn examples.protocol_fixture:app --port 9101
```

Use `ALLOW_PRIVATE_AGENTS=true` for the local gateway, set the HTTP URL to
`http://localhost:9101/visuals`, and send a prompt. The service returns a line
chart with a working filter slider, an unknown vendor result with an SVG
topology, and a metric—all without frontend renderer registration.

The implementation lives in [visual_fixture.py](../examples/visual_fixture.py).
The browser test verifies rendered images, a changed chart after moving the
slider, mixed dashboard results and blocked script/external-data payloads.
