# Verification — 2026-09-18

Validated locally with Python 3.13 and Node 24.21.0 against the updated
lockfiles. These results cover the v1 runtime, universal adapters and declarative visualizations unless explicitly marked older.

| Check | Result |
| --- | --- |
| Backend unit/contract tests | 47 passed |
| Frontend schema/runtime/component/transport/visualization tests | 229 passed |
| Pinned upstream A2UI schema cases (included above) | 153 passed |
| Browser workflows | 5 passed against the production build |
| Ruff / formatting / ty / codespell | Passed |
| ESLint / TypeScript / Vite production build | Passed |
| npm audit | 0 reported vulnerabilities |
| localhost:5173 / localhost:8000/api/health | HTTP 200; API advertises pinned v1 candidate |
| Updated live ADK evaluation | Blocked before execution by approval guard |

The browser suite covers:
1. HTTP, MCP, AG-UI and the real ADK/A2A wrapper: register, discover, invoke,
   inspect results, refresh and remove.
2. HTTP v1 form: create, data binding, scoped list, remote function response,
   asynchronous regex validation, structured submit, model synchronization and
   delete.
3. The same full form round trip over AG-UI.
4. OpenAPI registration, generated nested query/body fields, schema validation,
   mutation confirmation, response rendering, a separately registered HTTP
   adapter, and an endpoint-free in-process adapter. No frontend code branches
   for either example adapter.
5. A service-defined chart with a working parameter slider, an unknown vendor
   result carrying a custom SVG topology, mixed dashboard results, and rejection
   of executable SVG and external chart-data URLs.

The full suite also runs against the built application with
`RELAY_E2E_PREVIEW=1 npm run test:e2e` from `web/`. This verifies bundled worker
loading, not just the Vite development path.

Screenshots of the two submitted forms were generated. The HTTP screenshot was
visually inspected. The adapter and new bespoke-visual screenshot were also visually inspected. Screenshots and test output are local/ignored.

The 153 upstream cases establish pinned **schema validation**, not complete
behavioral conformance. Separate tests exercise all 18 basic component renderers,
input mutation, tabs/modal controls, accessibility descriptions, basic functions,
catalog overrides, function caller boundaries, repeated RPC calls, timeout
handling, ownership isolation, composition constraints, atomic invalid updates,
continued batches, Unicode metadata, and pointer/prototype safety.

Backend v1 tests exercise typed HTTP/AG-UI return mappings, MCP tool dispatch and
request metadata, protobuf A2A data-part serialization and task/context IDs, and
ADK RPC dispatch without model calls. MCP/A2A v1 bindings have contract tests;
Adapter/OpenAPI tests additionally cover registry validation, endpoint policy,
input schemas, local references, header/query/path serialization, confirmation,
unsupported-operation diagnostics, same-origin restriction and no implicit
operation invocation at discovery. Full browser v1 interaction against MCP/A2A or a chosen vendor
has not been verified. No first vendor was selected.

## Live model evaluation status

The previous revision passed three coordinator cases: onboarding, grounded
workspace status and connection discovery, each scoring 1.0 for tool trajectory
and rubric-based response quality. **That result predates the v1 tool changes.**

A fresh evaluation was requested against the previously configured Vertex AI
project and rejected by the approval guard before execution: it would send eval
inputs to Google Cloud and could incur charges without confirmed destination
authorization. No workaround was attempted. The new ADK tools therefore still
need an approved live behavior evaluation; do not present the old scores as
verification of this revision.

The ADK evaluation workflow informed the separation of deterministic contract
tests from model-behavior evaluation. The configured Gemini model was preserved.

## Known warnings and boundaries

The build succeeds with a ~719 kB pre-gzip main JavaScript chunk (~213 kB gzip),
which triggers Vite's default chunk-size advisory. A separate ~796 kB chart
worker bundle is loaded only when needed. Visualization tests cover six chart
marks, inline geographic data, native Vega, interpreted expressions with
JavaScript code generation disabled, bound controls, SVG restrictions, worker
concurrency, timeout and cancellation. Upstream packages emit
experimental/deprecation warnings for ADK A2A and in-memory credential services.
These are not hidden.

These checks do not establish production security, upstream certification, full
protocol conformance, or compatibility with every vendor. See
[protocol-audit.md](protocol-audit.md) for explicit remaining gaps. No deployment,
commit or push was performed as part of this revision.
