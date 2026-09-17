import type { A2UIComponent, A2UISurface, ResultBlock } from './types'

const id = () => crypto.randomUUID()

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asSurface(value: unknown): A2UISurface | null {
  const item = object(value)
  if (!item) return null
  const create = object(item.createSurface)
  if (create && Array.isArray(create.components)) return {
    surfaceId: String(create.surfaceId || 'generated'),
    components: create.components as A2UIComponent[],
    data: object(create.dataModel) || object(create.data) || undefined,
  }
  if (Array.isArray(item.components)) return {
    surfaceId: String(item.surfaceId || 'generated'),
    components: item.components as A2UIComponent[],
    data: object(item.data || item.dataModel) || undefined,
  }
  return null
}

function dataEntries(value: Record<string, unknown>): Record<string, unknown> {
  const direct = object(value.dataModel) || object(value.data)
  if (direct) return direct
  if (!Array.isArray(value.contents)) return {}
  return Object.fromEntries(value.contents.flatMap((entry) => {
    const row = object(entry)
    if (!row || typeof row.key !== 'string') return []
    return [[row.key, row.value ?? row]]
  }))
}

function surfacesFromOperations(operations: unknown[]): A2UISurface[] {
  const surfaces = new Map<string, A2UISurface>()
  for (const operation of operations) {
    const direct = asSurface(operation)
    if (direct) surfaces.set(direct.surfaceId, direct)

    const envelope = object(operation)
    if (!envelope) continue
    const create = object(envelope.createSurface)
    if (create) {
      const surfaceId = String(create.surfaceId || 'generated')
      surfaces.set(surfaceId, {
        surfaceId,
        components: Array.isArray(create.components) ? create.components as A2UIComponent[] : [],
        data: dataEntries(create),
      })
    }

    const update = object(envelope.updateComponents)
    if (update) {
      const surfaceId = String(update.surfaceId || 'generated')
      const current = surfaces.get(surfaceId) || { surfaceId, components: [], data: {} }
      surfaces.set(surfaceId, {
        ...current,
        components: Array.isArray(update.components) ? update.components as A2UIComponent[] : current.components,
      })
    }

    const dataUpdate = object(envelope.updateDataModel)
    if (dataUpdate) {
      const surfaceId = String(dataUpdate.surfaceId || 'generated')
      const current = surfaces.get(surfaceId) || { surfaceId, components: [], data: {} }
      surfaces.set(surfaceId, { ...current, data: { ...current.data, ...dataEntries(dataUpdate) } })
    }

    const removed = object(envelope.deleteSurface)
    if (removed) surfaces.delete(String(removed.surfaceId || 'generated'))
  }
  return [...surfaces.values()].filter((surface) => surface.components.length > 0)
}

function isSurfaceOperation(value: unknown): boolean {
  const item = object(value)
  return Boolean(item && ('createSurface' in item || 'updateComponents' in item || 'updateDataModel' in item || 'deleteSurface' in item))
}

function unwrapPart(value: unknown): unknown {
  const item = object(value)
  return item?.root || value
}

function fileBlock(file: Record<string, unknown>, source: string): ResultBlock {
  const mimeType = String(file.mimeType || file.mime_type || 'application/octet-stream')
  const name = String(file.name || file.filename || 'Agent artifact')
  const rawUrl = file.uri || file.url
  const bytes = file.bytes || file.data
  const url = rawUrl ? String(rawUrl) : bytes ? `data:${mimeType};base64,${String(bytes)}` : undefined
  const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : 'file'
  return { id: id(), kind, name, title: name, mimeType, url, source }
}

export function normalizeResult(value: unknown, source = 'agent'): ResultBlock[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try { return normalizeResult(JSON.parse(trimmed), source) }
    catch { return [{ id: id(), kind: 'text', text: value, source }] }
  }
  if (typeof value !== 'object') return [{ id: id(), kind: 'text', text: String(value), source }]
  if (Array.isArray(value)) {
    if (value.some(isSurfaceOperation)) {
      return surfacesFromOperations(value).map((surface) => ({ id: id(), kind: 'a2ui', surface, title: surface.surfaceId, source }))
    }
    if (value.length && value.every((row) => object(row))) return [{ id: id(), kind: 'table', data: value, source }]
    return value.flatMap((item) => normalizeResult(item, source))
  }

  const item = object(unwrapPart(value))!
  const surface = asSurface(item)
  if (surface) return [{ id: id(), kind: 'a2ui', surface, title: surface.surfaceId, source }]

  const operations = item.a2ui_operations || item.operations
  if (Array.isArray(operations)) {
    const surfaces = surfacesFromOperations(operations)
    if (surfaces.length) return surfaces.map((entry) => ({ id: id(), kind: 'a2ui', surface: entry, title: entry.surfaceId, source }))
  }

  if (item.kind === 'text' || typeof item.text === 'string') return [{ id: id(), kind: 'text', text: String(item.text || ''), source }]
  if (item.kind === 'file' || item.file) return [fileBlock(object(item.file) || item, source)]
  if (item.kind === 'data' || item.data !== undefined) return normalizeResult(item.data, source)

  if (Array.isArray(item.parts)) return item.parts.flatMap((part) => normalizeResult(part, source))
  if (Array.isArray(item.artifacts)) return item.artifacts.flatMap((artifact) => normalizeResult(artifact, source))
  if (item.artifact) return normalizeResult(item.artifact, source)
  if (item.message) return normalizeResult(item.message, source)
  if (item.task) return [item.task, item.update].flatMap((entry) => normalizeResult(entry, source))
  if (item.result !== undefined) return normalizeResult(item.result, source)
  if (item.error) return [{ id: id(), kind: 'error', text: typeof item.error === 'string' ? item.error : JSON.stringify(item.error), source }]

  const rows = Object.entries(item)
  if (rows.length && rows.every(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry))) {
    return [{ id: id(), kind: 'table', data: rows.map(([key, entry]) => ({ field: key, value: entry })), source }]
  }
  return [{ id: id(), kind: 'json', data: item, title: 'Structured result', source }]
}

export function surfaceFromToolArgs(raw: string): A2UISurface | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.components === 'string') parsed.components = JSON.parse(parsed.components)
    if (typeof parsed.data === 'string') parsed.data = JSON.parse(parsed.data)
    return asSurface(parsed)
  } catch { return null }
}
