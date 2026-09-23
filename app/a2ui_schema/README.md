# Pinned upstream A2UI schemas

Source: https://github.com/a2ui-project/a2ui
Commit: 04e6f07fde12ff2638b3b489bd9e3033066cb957
Directory: specification/v1_0/json; basic_catalog.json from specification/v1_0/catalogs.
License: Apache-2.0 (included).

These files are unmodified upstream schemas for the v1.0 candidate. A candidate
is not a production-stable release. Review schema changes and run the complete
fixture/runtime suite before updating this pin.

The frontend's fixtures are copied from this commit's v1 test suite. Its
expression-parser.ts is adapted from renderers/web_core/src/v0_9/basic_catalog/
expressions/expression_parser.ts: removed legacy returnType, changed JSON typing,
and allowed Unicode / @index path tokens. Upstream copyright is retained.

Passing schema fixtures proves schema validation, not complete behavioral
interoperability. Runtime, component, and transport tests are separate.
