import { createParser } from 'eventsource-parser'
import type { ProtocolEvent } from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiBase + path, { credentials: apiBase ? 'include' : 'same-origin', ...init })
}

export async function consumeEvents(response: Response, onEvent: (event: ProtocolEvent) => void): Promise<void> {
  if (!response.ok || !response.body) throw new Error(`Agent request failed (HTTP ${response.status}).`)
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected an SSE stream from this endpoint.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createParser({
    onEvent: ({ data }) => {
      if (data === '[DONE]') return
      const event: unknown = JSON.parse(data)
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Malformed protocol event.')
      onEvent(event as ProtocolEvent)
    },
  })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode() + '\n\n')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
