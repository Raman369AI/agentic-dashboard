import type { AgentRecord, ProtocolEvent } from './types'

const jsonHeaders = { 'Content-Type': 'application/json' }

export async function getAgents(): Promise<AgentRecord[]> {
  const response = await fetch('/api/agents')
  if (!response.ok) throw new Error('Could not load the agent registry.')
  const payload = await response.json() as { agents: AgentRecord[] }
  return payload.agents
}

export async function registerAgent(url: string): Promise<AgentRecord> {
  const response = await fetch('/api/agents', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url }),
  })
  const payload = await response.json().catch(() => ({})) as { detail?: string } & AgentRecord
  if (!response.ok) throw new Error(payload.detail || 'Could not connect this agent.')
  return payload
}

export async function removeAgent(id: string): Promise<void> {
  const response = await fetch(`/api/agents/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Could not remove this agent.')
}

export async function streamAgent(
  threadId: string,
  messages: { id: string; role: string; content: string }[],
  signal: AbortSignal,
  onEvent: (event: ProtocolEvent) => void,
): Promise<void> {
  const response = await fetch('/api/ag-ui', {
    method: 'POST',
    headers: { ...jsonHeaders, Accept: 'text/event-stream' },
    signal,
    body: JSON.stringify({
      threadId,
      runId: crypto.randomUUID(),
      messages,
      state: {},
      context: [],
      forwardedProps: { injectA2UITool: true },
      tools: [{
        name: 'render_a2ui',
        description: 'Render a safe declarative A2UI dashboard in the workspace canvas.',
        parameters: {
          type: 'object',
          properties: {
            surfaceId: { type: 'string' },
            components: { type: 'array', items: { type: 'object' } },
            data: { type: 'object' },
          },
          required: ['surfaceId', 'components'],
        },
      }],
    }),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(payload.detail || `Agent request failed (${response.status}).`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const line = frame.split('\n').find((item) => item.startsWith('data:'))
      if (!line) continue
      try { onEvent(JSON.parse(line.slice(5).trim()) as ProtocolEvent) } catch { /* heartbeat */ }
    }
  }
}
