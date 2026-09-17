import type { A2UISurface } from '../types'

function atPath(data: Record<string, unknown>, path?: string): unknown {
  if (!path) return undefined
  return path.split('/').filter(Boolean).reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }, data)
}

function resolved(value: unknown, data: Record<string, unknown>): string {
  if (typeof value === 'object' && value && 'path' in value) {
    return String(atPath(data, String((value as { path: unknown }).path)) ?? '')
  }
  return String(value ?? '')
}

export function A2UIRenderer({ surface }: { surface: A2UISurface }) {
  const byId = new Map(surface.components.map((component) => [component.id, component]))
  const data = surface.data || {}

  const render = (id: string): React.ReactNode => {
    const node = byId.get(id)
    if (!node) return <div className="unknown-widget">Missing component: {id}</div>
    const children = (node.children || (node.child ? [node.child] : [])).map(render)
    const key = `${surface.surfaceId}-${node.id}`
    switch (node.component.toLowerCase()) {
      case 'column': return <div className="a2-column" key={key}>{children}</div>
      case 'row': return <div className="a2-row" key={key}>{children}</div>
      case 'card': return <section className="a2-card" key={key}>{children}</section>
      case 'text': {
        const text = resolved(node.text, data)
        if (node.variant === 'title' || text.startsWith('# ')) return <h3 key={key}>{text.replace(/^#\s*/, '')}</h3>
        if (node.variant === 'caption') return <span className="a2-caption" key={key}>{text}</span>
        return <p key={key}>{text}</p>
      }
      case 'button': return <button className="a2-button" key={key}>{children.length ? children : node.label || 'Continue'}</button>
      case 'textfield': return <label className="a2-field" key={key}><span>{node.label || 'Value'}</span><input placeholder={String(node.placeholder || '')} /></label>
      case 'divider': return <hr key={key} />
      case 'metric': return <article className="metric-card" key={key}><span>{node.label}</span><strong>{resolved(node.value, data)}</strong><small>{String(node.trend || '')}</small></article>
      case 'progress': return <div className="a2-progress" key={key}><span>{node.label}</span><div><i style={{ width: `${Number(node.value || 0)}%` }} /></div></div>
      case 'table': {
        const rows = Array.isArray(node.rows) ? node.rows as Record<string, unknown>[] : []
        const columns = Array.isArray(node.columns) ? node.columns.map(String) : Object.keys(rows[0] || {})
        return <div className="table-wrap" key={key}><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
      }
      default: return <div className="unknown-widget" key={key}>Unsupported: {node.component}</div>
    }
  }

  const root = byId.has('root') ? 'root' : surface.components[0]?.id
  return <div className="a2-surface">{root ? render(root) : <p>Empty surface</p>}</div>
}

export const demoSurface: A2UISurface = {
  surfaceId: 'workspace-overview',
  components: [
    { id: 'root', component: 'Column', children: ['metrics', 'run-card', 'agents-card'] },
    { id: 'metrics', component: 'Row', children: ['m1', 'm2', 'm3'] },
    { id: 'm1', component: 'Metric', label: 'Active agents', value: '04', trend: '+1 this week' },
    { id: 'm2', component: 'Metric', label: 'Tasks today', value: '128', trend: '18% faster' },
    { id: 'm3', component: 'Metric', label: 'Success rate', value: '98.4%', trend: '+2.1%' },
    { id: 'run-card', component: 'Card', children: ['run-title', 'run-copy', 'progress'] },
    { id: 'run-title', component: 'Text', variant: 'title', text: 'Live orchestration' },
    { id: 'run-copy', component: 'Text', text: 'The coordinator is ready to route work across connected specialists.' },
    { id: 'progress', component: 'Progress', label: 'Workspace readiness', value: 84 },
    { id: 'agents-card', component: 'Card', children: ['agents-title', 'agents-table'] },
    { id: 'agents-title', component: 'Text', variant: 'title', text: 'Agent network' },
    { id: 'agents-table', component: 'Table', columns: ['Agent', 'Protocol', 'Status'], rows: [
      { Agent: 'Workspace coordinator', Protocol: 'ADK · AG-UI', Status: 'Online' },
      { Agent: 'Add a specialist', Protocol: 'A2A', Status: 'Ready' },
    ] },
  ],
}
