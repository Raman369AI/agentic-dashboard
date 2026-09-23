import { useState } from 'react'
import type { A2UISurface } from '../types'
import { safeUrl } from '../protocol'

function atPath(data: Record<string, unknown>, path?: string): unknown {
  if (!path || path.split('/').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) return undefined
  return path.split('/').filter(Boolean).reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, data)
}

function setAtPath(data: Record<string, unknown>, path: string, value: unknown) {
  if (path.split('/').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) return data
  const copy = structuredClone(data)
  const keys = path.split('/').filter(Boolean)
  let cursor = copy
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  })
  if (keys.length) cursor[keys.at(-1)!] = value
  return copy
}

function binding(value: unknown): string | undefined {
  return typeof value === 'object' && value && 'path' in value ? String((value as { path: unknown }).path) : undefined
}

function resolved(value: unknown, data: Record<string, unknown>): string {
  const path = binding(value)
  return String(path ? atPath(data, path) ?? '' : value ?? '')
}

export function A2UIRenderer({ surface, onAction }: { surface: A2UISurface; onAction?: (name: string, context: unknown, data: Record<string, unknown>) => void }) {
  const [data, setData] = useState<Record<string, unknown>>(surface.data || {})
  const [activeTabs, setActiveTabs] = useState<Record<string, number>>({})
  const byId = new Map(surface.components.map((component) => [component.id, component]))

  const action = (node: Record<string, unknown>) => {
    const spec = node.action && typeof node.action === 'object' ? node.action as Record<string, unknown> : {}
    const event = spec.event && typeof spec.event === 'object' ? spec.event as Record<string, unknown> : spec
    onAction?.(String(event.name || node.id), event.context, data)
  }

  const update = (valueSpec: unknown, next: unknown) => {
    const path = binding(valueSpec)
    if (path) setData((current) => setAtPath(current, path, next))
  }

  const render = (id: string, ancestors: string[] = []): React.ReactNode => {
    if (ancestors.includes(id) || ancestors.length > 40) return <p key={id}>Invalid cyclic or deeply nested component: {id}</p>
    const node = byId.get(id)
    if (!node) return <div className="unknown-widget">Missing component: {id}</div>
    const children = (Array.isArray(node.children) ? node.children : node.child ? [node.child] : []).map((child) => render(child, [...ancestors, id]))
    const key = `${surface.surfaceId}-${node.id}`
    switch (node.component.toLowerCase()) {
      case 'column': return <div className="a2-column" key={key}>{children}</div>
      case 'row': return <div className="a2-row" key={key}>{children}</div>
      case 'grid': return <div className="a2-grid" key={key} style={{ gridTemplateColumns: `repeat(${Number(node.columns || 2)}, minmax(0, 1fr))` }}>{children}</div>
      case 'card': return <section className="a2-card" key={key}>{children}</section>
      case 'text': case 'markdown': {
        const text = resolved(node.text, data)
        if (node.variant === 'title' || text.startsWith('# ')) return <h3 key={key}>{text.replace(/^#\s*/, '')}</h3>
        if (node.variant === 'caption') return <span className="a2-caption" key={key}>{text}</span>
        return <p key={key}>{text}</p>
      }
      case 'button': return <button className="a2-button" key={key} onClick={() => action(node)}>{children.length ? children : String(node.label || 'Continue')}</button>
      case 'textfield': return <label className="a2-field" key={key}><span>{String(node.label || 'Value')}</span><input value={resolved(node.value, data)} placeholder={String(node.placeholder || '')} onChange={(event) => update(node.value, event.target.value)} /></label>
      case 'checkbox': return <label className="a2-checkbox" key={key}><input type="checkbox" checked={resolved(node.value, data) === 'true'} onChange={(event) => update(node.value, event.target.checked)} /><span>{String(node.label || '')}</span></label>
      case 'choicepicker': case 'select': {
        const options = Array.isArray(node.options) ? node.options as Array<Record<string, unknown> | string> : []
        return <label className="a2-field" key={key}><span>{String(node.label || 'Choose')}</span><select value={resolved(node.value, data)} onChange={(event) => update(node.value, event.target.value)}>{options.map((option) => { const item = typeof option === 'string' ? { label: option, value: option } : option; return <option value={String(item.value)} key={String(item.value)}>{String(item.label)}</option> })}</select></label>
      }
      case 'divider': return <hr key={key} />
      case 'metric': return <article className="metric-card" key={key}><span>{String(node.label || '')}</span><strong>{resolved(node.value, data)}</strong><small>{String(node.trend || '')}</small></article>
      case 'progress': return <div className="a2-progress" key={key}><span>{String(node.label || '')}</span><div><i style={{ width: `${Math.min(100, Number(node.value || 0))}%` }} /></div></div>
      case 'image': return <figure className="a2-image" key={key}><img src={safeUrl(resolved(node.url || node.src, data))} alt={String(node.alt || '')} /><figcaption>{String(node.caption || '')}</figcaption></figure>
      case 'audio': return <audio key={key} src={safeUrl(resolved(node.url || node.src, data))} controls />
      case 'video': return <video className="a2-video" key={key} src={safeUrl(resolved(node.url || node.src, data))} controls />
      case 'code': return <pre className="a2-code" key={key}><code>{resolved(node.code || node.text, data)}</code></pre>
      case 'badge': return <span className="a2-badge" key={key}>{resolved(node.text || node.label, data)}</span>
      case 'list': return <ul className="a2-list" key={key}>{(Array.isArray(node.items) ? node.items : []).map((item, index) => <li key={index}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>)}</ul>
      case 'tabs': {
        const tabs = Array.isArray(node.children) ? node.children : []
        const active = activeTabs[node.id] || 0
        const labels = Array.isArray(node.labels) ? node.labels.map(String) : tabs.map((_, index) => `Tab ${index + 1}`)
        return <div className="a2-tabs" key={key}><div>{labels.map((label, index) => <button className={active === index ? 'active' : ''} onClick={() => setActiveTabs((state) => ({ ...state, [node.id]: index }))} key={label}>{label}</button>)}</div>{tabs[active] ? render(tabs[active], [...ancestors, id]) : null}</div>
      }
      case 'table': {
        const rows = Array.isArray(node.rows) ? node.rows as Record<string, unknown>[] : []
        const columns = Array.isArray(node.columns) ? node.columns.map(String) : Object.keys(rows[0] || {})
        return <div className="table-wrap" key={key}><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
      }
      default: return <details className="unknown-widget" key={key}><summary>{node.component}</summary><pre>{JSON.stringify(node, null, 2)}</pre></details>
    }
  }

  const root = byId.has('root') ? 'root' : surface.components[0]?.id
  return <div className="a2-surface">{root ? render(root) : <p>Empty surface</p>}</div>
}

export const emptySurface: A2UISurface = { surfaceId: 'query-results', components: [] }
