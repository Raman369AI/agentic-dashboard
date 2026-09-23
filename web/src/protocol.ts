import { A2UIRuntime } from './a2ui/runtime'
import type { A2UIComponent, A2UISurface, ResultBlock } from './types'

const id = () => crypto.randomUUID()
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor'])

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^https?:\/\//i.test(value) || /^blob:/i.test(value) || /^data:(image\/(?:png|jpeg|gif|webp)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf);base64,/i.test(value)) return value
  if (value.startsWith('/') && !value.startsWith('//')) return value
  return undefined
}

function asSurface(value: unknown): A2UISurface | null {
  const item = object(value)
  if (!item || !Array.isArray(item.components)) return null
  const components = item.components.filter((v) => object(v) && typeof v.id === 'string' && typeof v.component === 'string') as A2UIComponent[]
  if (components.length !== item.components.length) return null
  return { surfaceId: String(item.surfaceId || 'generated'), components, data: object(item.data || item.dataModel) || {} }
}

function putPath(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('/').filter(Boolean).map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (!keys.length) return object(value) || { value }
  if (keys.some((key) => blockedKeys.has(key))) return data
  const copy = structuredClone(data)
  let cursor = copy
  for (const key of keys.slice(0, -1)) {
    cursor[key] = object(cursor[key]) ? { ...object(cursor[key]) } : {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys.at(-1)!] = value
  return copy
}

export class ResultNormalizer {
  readonly a2ui = new A2UIRuntime()
  owner = 'coordinator'
  setOwner(owner: string) { this.owner = owner }
  private surfaces = new Map<string, A2UISurface>()

  private operation(item: Record<string, unknown>, source: string): ResultBlock[] | null {
    const incoming = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface', 'callRendererFunction', 'agentFunctionResponse']
    if (item.version === 'v1.0') {
      const before = this.a2ui.errors.length
      const touched = this.a2ui.process(item, this.owner)
      return [...touched.map((surfaceId): ResultBlock => ({ id: 'v1:' + surfaceId, kind: this.a2ui.surfaces.has(surfaceId) ? 'a2ui-v1' : 'surface-delete', surfaceId, source, title: surfaceId })), ...this.a2ui.errors.slice(before).map((error): ResultBlock => ({ id: id(), kind: 'error', text: error.message, data: item, source: 'A2UI v1' }))]
    }
    if (item.version && incoming.some((name) => name in item) && !['v0.9', 'v0.9.1'].includes(String(item.version))) return [{ id: id(), kind: 'error', text: 'Unsupported A2UI version: ' + item.version, data: item, source }]
    for (const name of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
      const op = object(item[name])
      if (!op) continue
      const surfaceId = String(op.surfaceId || 'generated')
      if (name === 'deleteSurface') {
        this.surfaces.delete(surfaceId)
        return [{ id: surfaceId, kind: 'surface-delete', surfaceId, source }]
      }
      let surface = this.surfaces.get(surfaceId) || { surfaceId, components: [], data: {} }
      if (name === 'createSurface') surface = { surfaceId, components: [], data: {} }
      if (Array.isArray(op.components)) {
        const parsed = asSurface({ surfaceId, components: op.components })
        if (!parsed) return [{ id: id(), kind: 'json', data: item, source, title: 'Unsupported surface payload' }]
        const components = new Map(surface.components.map((component) => [component.id, component]))
        for (const component of parsed.components) components.set(component.id, component)
        surface = { ...surface, components: [...components.values()] }
      }
      if (name === 'updateDataModel') {
        const value = op.value ?? op.data ?? op.dataModel
        surface = { ...surface, data: putPath(surface.data || {}, String(op.path || ''), value ?? {}) }
      } else if (object(op.data || op.dataModel)) surface = { ...surface, data: object(op.data || op.dataModel)! }
      this.surfaces.set(surfaceId, surface)
      return surface.components.length ? [{ id: surfaceId, kind: 'a2ui', surface, title: surfaceId, source }] : []
    }
    return null
  }

  normalize(value: unknown, source = 'agent', depth = 0): ResultBlock[] {
    const json = (data: unknown, title = 'Structured result'): ResultBlock[] => [{ id: id(), kind: 'json', data, title, source }]
    const recurse = (v: unknown) => this.normalize(v, source, depth + 1)
    if (value === undefined) return []
    if (value === null) return json(null, 'Null result')
    if (depth > 30) return json(value, 'Nested result')
    if (typeof value === 'string') {
      if (!value.trim()) return []
      try {
        const parsed = JSON.parse(value)
        if (parsed !== value) return recurse(parsed)
      } catch { /* plain text */ }
      return [{ id: id(), kind: 'text', text: value, source }]
    }
    if (typeof value !== 'object') return [{ id: id(), kind: 'text', text: String(value), source }]
    if (Array.isArray(value)) {
      if (!value.length) return json(value, 'Empty result')
      const blockKeys = ['parts', 'artifacts', 'content', 'surfaceId', 'version', 'createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']
      const blockKinds = new Set(['text', 'markdown', 'image', 'audio', 'video', 'file', 'data', 'resource', 'resource_link', 'chart', 'metric', 'table', 'error', 'svg', 'vega', 'vega-lite', 'dashboard'])
      const rows = value.every((row) => { const r = object(row); return r && !r.kind && !blockKeys.some((key) => key in r) && !blockKinds.has(String(r.kind || r.type || '')) })
      if (rows) return [{ id: id(), kind: 'table', data: value, source }]
      // Preserve all blocks while replacing cumulative updates to the same surface.
      const blocks = value.flatMap(recurse)
      return blocks.filter((block, index) => !['a2ui', 'a2ui-v1', 'surface-delete'].includes(block.kind) || !blocks.slice(index + 1).some((later) => later.id === block.id))
    }
    const item = object(value)!
    if (object(item.root) && ('kind' in object(item.root)! || 'text' in object(item.root)!)) return recurse(item.root)
    const operation = this.operation(item, source)
    if (operation !== null) return operation
    const surface = asSurface(item)
    if (surface) {
      this.surfaces.set(surface.surfaceId, surface)
      return [{ id: surface.surfaceId, kind: 'a2ui', surface, title: surface.surfaceId, source }]
    }
    const kind = String(item.kind || item.type || '')
    const visualKinds = ['svg', 'vega', 'vega-lite', 'dashboard']
    const presentation = object(item.presentation)
    if (presentation && visualKinds.includes(String(presentation.kind))) return recurse(presentation).map((block) => ({ ...block, original: item }))
    const schema = typeof item.$schema === 'string' ? item.$schema : ''
    if (/^https:\/\/vega.github.io\/schema\/(vega-lite|vega)\//.test(schema)) return recurse({ kind: schema.includes('/vega-lite/') ? 'vega-lite' : 'vega', spec: item })
    if (kind === 'dashboard') {
      if (depth > 8 || !Array.isArray(item.children) || item.children.length > 24) return json(item, 'Dashboard requires at most 24 child blocks')
      return [{ id: id(), kind, title: String(item.title || 'Dashboard'), columns: Math.min(6, Math.max(1, Math.floor(Number(item.columns) || 2))), children: item.children.flatMap(recurse), data: item, source }]
    }
    if (['svg', 'vega', 'vega-lite'].includes(kind)) return [{ id: id(), kind, data: item, title: typeof item.title === 'string' ? item.title : undefined, source }]
    const mediaType = item.mimeType || item.mediaType
    if (mediaType === 'image/svg+xml' && typeof item.text === 'string') return recurse({ kind: 'svg', svg: item.text, title: item.name })
    if (typeof mediaType === 'string' && /^application\/vnd\.vega(?:lite)?\.v[0-9]+\+json$/.test(mediaType) && item.data !== undefined) return recurse({ kind: mediaType.includes('vegalite') ? 'vega-lite' : 'vega', spec: item.data })
    if (['CUSTOM', 'RAW'].includes(kind)) return recurse(item.value ?? item.data ?? item.event ?? { payload: item })
    if (['TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CHUNK'].includes(kind)) return recurse(item.delta)
    if (kind === 'TOOL_CALL_RESULT') return recurse(item.content ?? item.result)
    if (kind === 'STATE_SNAPSHOT') return recurse(item.snapshot)
    if (['RUN_STARTED', 'RUN_FINISHED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_END'].includes(kind)) return []
    if (kind === 'RUN_ERROR' || item.status === 'error') return [{ id: id(), kind: 'error', text: String(item.message || JSON.stringify(item.events || item)), source }]
    if (item.error || item.isError || item.is_error || kind === 'error') {
      const text = typeof item.error === 'string' ? item.error : typeof item.message === 'string' ? item.message : JSON.stringify(item.error || item.content || item)
      return [{ id: id(), kind: 'error', text, source }]
    }
    if (Array.isArray(item.a2ui_messages || item.a2uiMessages)) return recurse(item.a2ui_messages || item.a2uiMessages)
    if (item.data !== undefined && (object(item.metadata)?.mimeType === 'application/a2ui+json' || item.mediaType === 'application/a2ui+json')) return recurse(item.data)
    if (Array.isArray(item.a2ui_operations || item.operations)) return recurse(item.a2ui_operations || item.operations)
    if (kind === 'chart' && Array.isArray(item.data)) return [{ id: id(), kind: 'chart', data: item.data, title: String(item.title || 'Chart'), xKey: String(item.xKey || ''), yKey: String(item.yKey || ''), source }]
    if (kind === 'metric') return [{ id: id(), kind: 'metric', title: String(item.label || item.title || ''), text: String(item.value ?? ''), source }]
    if (kind === 'table' && Array.isArray(item.rows || item.data)) return [{ id: id(), kind: 'table', data: item.rows || item.data, source }]

    const file = object(item.file) || item
    const mime = String(file.mimeType || file.mediaType || file.mime_type || '')
    if (item.file || ['file', 'image', 'audio', 'video', 'resource_link'].includes(kind) || (mime && (file.url || file.uri || file.raw))) {
      const mediaKind: ResultBlock['kind'] = mime.startsWith('image/') || kind === 'image' ? 'image' : mime.startsWith('audio/') || kind === 'audio' ? 'audio' : mime.startsWith('video/') || kind === 'video' ? 'video' : 'file'
      const bytes = file.bytes || file.raw || (['image', 'audio'].includes(kind) ? file.data : undefined)
      const url = safeUrl(file.uri || file.url || (bytes ? `data:${mime};base64,${String(bytes)}` : undefined))
      if (!url) return json(item, 'File metadata (no supported preview URL)')
      return [{ id: id(), kind: mediaKind, url, name: String(file.name || file.filename || 'Artifact'), mimeType: mime, source }]
    }
    if (kind === 'resource' && object(item.resource)) return recurse(item.resource)
    // MCP may return structured data and content together. Preserve both.
    if (item.structuredContent !== undefined || item.structured_content !== undefined) {
      const structured = item.structuredContent ?? item.structured_content
      const content = Array.isArray(item.content) ? item.content.filter((part) => {
        if (!object(part) || typeof part.text !== 'string') return true
        try { return JSON.stringify(JSON.parse(part.text)) !== JSON.stringify(structured) } catch { return true }
      }) : []
      return [...recurse(structured), ...content.flatMap(recurse)]
    }
    if (Array.isArray(item.parts)) return item.parts.flatMap(recurse)
    if (Array.isArray(item.artifacts)) return item.artifacts.flatMap(recurse)
    if (Array.isArray(item.content)) return item.content.flatMap(recurse)
    if (Array.isArray(item.blocks)) return item.blocks.flatMap(recurse)
    if (Array.isArray(item.events)) return item.events.flatMap(recurse)
    if (item.task) return [...recurse(item.task), ...recurse(item.update)]
    if (item.artifact) return recurse(item.artifact)
    if (item.statusUpdate || item.artifactUpdate) return recurse(item.statusUpdate || item.artifactUpdate)
    if (item.message && typeof item.message === 'object') return recurse(item.message)
    if (object(item.status)?.message) return recurse(object(item.status)!.message)
    if (typeof item.text === 'string') return [{ id: id(), kind: kind === 'markdown' ? 'markdown' : 'text', text: item.text, source }]
    if (kind === 'data') return recurse(item.data)
    if (item.data !== undefined && Object.keys(item).every((key) => ['data', 'metadata'].includes(key)) && !item.metadata) return recurse(item.data)
    if (item.result !== undefined) return recurse(item.result)
    if (Array.isArray(item.rows)) return [{ id: id(), kind: 'table', data: item.rows, source }, ...Object.keys(item).some((key) => !['rows', 'columns'].includes(key)) ? json(item, 'Result metadata') : []]
    if (kind) return [{ id: id(), kind, data: item, source }]
    // Generic envelopes retain all fields rather than discarding data-adjacent metadata.
    const rows = Object.entries(item)
    if (rows.length && rows.every(([, child]) => ['string', 'number', 'boolean'].includes(typeof child))) return [{ id: id(), kind: 'table', data: rows.map(([field, value]) => ({ field, value })), source }]
    return json(item)
  }
}

export function normalizeResult(value: unknown, source = 'agent'): ResultBlock[] {
  return new ResultNormalizer().normalize(value, source)
}

export function surfaceFromToolArgs(raw: string): A2UISurface | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.components === 'string') parsed.components = JSON.parse(parsed.components)
    if (typeof parsed.data === 'string') parsed.data = JSON.parse(parsed.data)
    return asSurface(parsed)
  } catch { return null }
}
