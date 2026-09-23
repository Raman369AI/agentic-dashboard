# Dependency audit - 2026-09-18

Versions were checked against the official PyPI JSON API and npm registry.
The lockfiles record the actual resolved graph; minimum versions alone do not
describe what is installed.

| Component | Before (installed/locked) | Now |
| --- | --- | --- |
| Google ADK | 1.39.1, constrained below 2 | 2.9.2 |
| A2A SDK | 0.3.26, constrained to 0.3 | 1.1.4 |
| AG-UI ADK | 0.7.0 | 0.7.0 (already current) |
| AG-UI protocol | 0.1.22 | 1.0.0 |
| MCP | 1.30.0 (transitive) | 2.2.0 (explicit) |
| FastAPI | 0.141.1 | 0.141.1 (already current) |
| React | 19.3.0 | 19.3.0 (already current) |
| Vite | 6.4.3 | 8.3.0 |
| Vitest | 2.1.9 | 5.0.1 |
| TypeScript | 5.7.3 | 6.0.3 |
| ESLint | 9.39.5 | 10.11.0 |
| Node for builds/tests | 20.19.4 | 24.21.0 |
| A2UI wire contract | Custom 0.9-like subset | v1.0 candidate, pinned schemas and Relay runtime |
| AJV / formats | Not used | 8.20.0 / 3.0.1 |
| date-fns | Not used | 4.4.0 |
| Python regex | Not used | 2026.9.10 |
| Vega / Vega-Lite | Not used | 6.4.0 / 6.4.3 |
| Vega expression interpreter | Not used | 2.3.2 |

## Compatibility decisions

- TypeScript 7.0.2 is published, but typescript-eslint 8.70.0 declares the
  peer range `>=4.8.4 <6.1.0`. TypeScript stays at 6.0.3 until that supported
  range changes. This is an explicit compatibility decision, not an unnoticed pin.
- Vitest 5 and current jsdom require a newer Node runtime. The project declares
  Node 24.15+ and pins the development version in `.node-version`.
- ADK's optional built-in MCP tool extra still constrains MCP below 2. Relay
  uses MCP 2 directly in its connection adapter and does not enable ADK's MCP
  extra. The coordinator accesses these services through Relay's own tools.
- A2A 1.x uses protobuf messages and `SendMessageRequest`, replacing the old
  Pydantic message parts and `ClientFactory.connect` path. Both legacy Relay
  routes and the new connection adapter are migrated.
- The A2A SDK supports legacy 0.3 Agent Cards through its compatibility layer.
  Browser interoperability tests exercise the current ADK A2A wrapper.
- A2UI v1 is a candidate wire specification. The published official React 0.11.1
  and web_core 0.11.0 packages still expose v0.8/v0.9 runtimes, so Relay's v1
  implementation uses pinned upstream schemas and its own tested React runtime.
  See [the v1 guide](a2ui-v1.md) for provenance and implementation boundaries.
- The regex dependency is used for Unicode identifier validation in the pinned
  schemas; browser-provided regex checks run in a bounded worker, not Python.
  [Current Python regex release](https://pypi.org/project/regex/2026.9.10/).
- The configured Gemini model was preserved. A library upgrade is not a model
  selection change.

The declarative visualization versions were verified with `npm view` against the official registry. Vega uses [the AST interpreter](https://vega.github.io/vega/usage/interpreter/) in cancellable workers; Vega-Lite is compiled to that same runtime. Charts do not load code from a CDN. These dependencies are lazy-loaded separately from the main client.

## Reproducibility and ongoing updates

Use `uv sync --locked` and `npm --prefix web ci` to install the committed graph.
Dependabot checks both manifests weekly. Review updates with backend tests,
frontend tests/build/lint, and the browser connection contract test.

Registry and implementation references:

- [Google ADK on PyPI](https://pypi.org/project/google-adk/)
- [A2A SDK releases](https://github.com/a2aproject/a2a-python/releases)
- [AG-UI ADK on PyPI](https://pypi.org/project/ag-ui-adk/)
- [MCP Python SDK client](https://py.sdk.modelcontextprotocol.io/client/)
- [Vite on npm](https://www.npmjs.com/package/vite)
- [TypeScript ESLint package](https://www.npmjs.com/package/typescript-eslint)
