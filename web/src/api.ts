import type { AgentRecord, ProtocolEvent } from './types'
import { apiFetch, consumeEvents } from './transport'

const jsonHeaders = { 'Content-Type': 'application/json' }

export async function getAgents(): Promise<AgentRecord[]> {
  const response = await apiFetch('/api/agents')
  if (!response.ok) throw new Error('Could not load the agent registry.')
  const payload = await response.json() as { agents: AgentRecord[] }
  return payload.agents
}

export async function registerAgent(url: string): Promise<AgentRecord> {
  const response = await apiFetch('/api/agents', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url }),
  })
  const payload = await response.json().catch(() => ({})) as { detail?: string } & AgentRecord
  if (!response.ok) throw new Error(payload.detail || 'Could not connect this agent.')
  return payload
}

export async function removeAgent(id: string): Promise<void> {
  const response = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Could not remove this agent.')
}

export async function invokeRemoteAgent(id: string, prompt: string, signal?: AbortSignal): Promise<unknown[]> {
  const response = await apiFetch(`/api/agents/${id}/invoke`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ prompt }), signal,
  })
  const payload = await response.json().catch(() => ({})) as { detail?: string; events?: unknown[] }
  if (!response.ok) throw new Error(payload.detail || 'The remote agent invocation failed.')
  return payload.events || []
}

export async function streamAgent(
  threadId: string,
  messages: { id: string; role: string; content: string }[],
  signal: AbortSignal,
  onEvent: (event: ProtocolEvent) => void,
  forwardedProps: Record<string, unknown> = {},
): Promise<void> {
  const response = await apiFetch('/api/ag-ui', {
    method: 'POST',
    headers: { ...jsonHeaders, Accept: 'text/event-stream' },
    signal,
    body: JSON.stringify({
      threadId,
      runId: crypto.randomUUID(),
      messages,
      state: {},
      context: [],
      forwardedProps: { ...forwardedProps, injectA2UITool: false },
      tools: [],
    }),
  })
  await consumeEvents(response, onEvent)
}
