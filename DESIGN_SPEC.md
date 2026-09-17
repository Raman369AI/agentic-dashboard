# Agentic Dashboard — Design Specification

## Overview

Agentic Dashboard is a standalone, protocol-first workspace for interacting
with Google ADK agents. It combines a first-class chat experience with a
universal dashboard canvas for agent-generated forms, metrics, tables, charts,
approvals, artifacts, and operational status.

The Python control plane is built on Google ADK and exposed to the browser over
AG-UI. Remote agents are discovered and invoked through A2A Agent Cards. Rich
agent output uses A2UI v0.9 messages and a strict client-side component catalog;
plain text remains a complete fallback.

## Example Use Cases

1. Chat with the built-in coordinator and inspect streamed tool activity.
2. Ask the coordinator to turn an analysis into an interactive dashboard.
3. Register a remote A2A agent by URL without changing application code.
4. Delegate work to a registered agent and display its text, data, or artifacts.
5. Keep chat beside a generated dashboard while switching conversations.

## Tools Required

- Google ADK with Gemini 3 Flash Preview for orchestration.
- `ag-ui-adk` for the AG-UI event stream and state synchronization.
- `a2a-sdk` for Agent Card discovery and remote task invocation.
- A2UI/AG-UI toolkit support for validated declarative UI generation.
- FastAPI for health, registry, and protocol endpoints.
- React and Vite for a fully standalone browser client.
- SQLite for the local agent registry.

Authentication supports either `GOOGLE_API_KEY` with AI Studio or Application
Default Credentials with Vertex AI. Remote-agent authentication can be added as
an interceptor without changing the registry contract.

## Constraints and Safety Rules

- The client never executes agent-generated JavaScript or HTML.
- Only components in the local A2UI catalog are rendered.
- Agent Cards and URL schemes are validated before persistence.
- Private, loopback, link-local, and metadata endpoints are blocked unless the
  operator explicitly enables local-agent development.
- Network operations use bounded timeouts and response sizes.
- Unknown components and protocol events degrade to visible safe fallbacks.
- Secrets are accepted only through environment variables.
- Destructive frontend actions require an explicit future approval flow.

## Success Criteria

- `make dev` launches the backend and standalone client.
- Chat streams standard AG-UI lifecycle, text, state, and tool-call events.
- A2UI output renders as trusted native React components.
- A remote A2A agent can be registered, inspected, invoked, and removed.
- The interface remains useful without a model key through its demo workspace.
- Backend tests, frontend tests, linting, and production builds pass.

## Edge Cases

- Invalid, duplicate, unreachable, or private Agent Card URLs.
- Remote agents that disconnect or return only partial tasks.
- Malformed A2UI operations or unsupported components.
- Browser refresh, empty threads, cancelled requests, and API unavailability.
- Missing Gemini credentials and model/provider errors.

## Initial Delivery

The first delivery is a local, prototype-first Git repository. It deliberately
contains no cloud deployment or CI/CD mutation; those can be added with the
Agent Starter Pack after choosing a deployment target.
