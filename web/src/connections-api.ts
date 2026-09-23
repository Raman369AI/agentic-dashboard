import type { AdapterDescriptor, ConnectionRecord, ConnectionRun, ConnectionSpec } from './connection-types'
import type { ProtocolEvent } from './types'
import { apiFetch, consumeEvents } from './transport'

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  const payload = await response.json()
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail || payload))
  return payload as T
}

export async function getAdapters(): Promise<AdapterDescriptor[]> {
  return (await jsonRequest<{ adapters: AdapterDescriptor[] }>('/api/connections/adapters')).adapters
}

export async function getConnections(): Promise<ConnectionRecord[]> {
  return (await jsonRequest<{ connections: ConnectionRecord[] }>('/api/connections')).connections
}
export const saveConnection = (spec: ConnectionSpec) => jsonRequest<ConnectionRecord>('/api/connections', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec),
})
export const discoverConnection = (id: string) => jsonRequest<ConnectionRecord['discovery']>(`/api/connections/${id}/discover`, { method: 'POST' })
export async function deleteConnection(id: string) {
  const response = await apiFetch(`/api/connections/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Could not remove the connection.')
}
export async function runConnection(id: string, run: ConnectionRun, signal: AbortSignal, onEvent: (event: ProtocolEvent) => void) {
  const response = await apiFetch(`/api/connections/${id}/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(run), signal,
  })
  await consumeEvents(response, onEvent)
}
