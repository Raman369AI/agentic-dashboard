import { Suspense, lazy, Component, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, Download, File, FileJson, Maximize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ResultBlock } from '../types'
import { A2UIRenderer } from './A2UIRenderer'
import { V1Surface } from '../a2ui/A2UIRenderer'
import { safeUrl } from '../protocol'

export type ResultProps = { block: ResultBlock; onExpand?: () => void; onAction?: (name: string, context: unknown, data: Record<string, unknown>) => void }
const renderers = new Map<string, ComponentType<ResultProps>>()
const ChartVisual = lazy(() => import('../visuals/VisualRenderer').then((module) => ({ default: module.ChartVisual })))
const SvgVisual = lazy(() => import('../visuals/VisualRenderer').then((module) => ({ default: module.SvgVisual })))

/** Register trusted application components during client startup. Never execute agent code. */
export function registerResultRenderer(kind: string, renderer: ComponentType<ResultProps>) { renderers.set(kind, renderer) }

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{text}</ReactMarkdown>
}

function Chart({ block }: ResultProps) {
  const data = Array.isArray(block.data) ? block.data as Record<string, unknown>[] : []
  const valid = data.length > 0 && data.every((row) => row && typeof row[block.yKey || ''] === 'number')
  if (!valid) return <Json block={{ ...block, title: 'Chart data: provide numeric yKey and label xKey' }} />
  const max = Math.max(...data.map((row) => Math.abs(Number(row[block.yKey!]))), 1)
  return <figure className="result-chart"><figcaption>{block.title}</figcaption>{data.map((row, index) => <div className="chart-row" key={index}><span>{String(row[block.xKey!] ?? index)}</span><div><i style={{ width: `${Math.abs(Number(row[block.yKey!])) / max * 100}%` }} /></div><strong>{String(row[block.yKey!])}</strong></div>)}</figure>
}
function Json({ block }: ResultProps) {
  return <details className="json-result" open><summary><FileJson size={15} />{block.title || 'Structured result'}</summary><pre>{JSON.stringify(block.data ?? block, null, 2)}</pre></details>
}

class RenderBoundary extends Component<{ block: ResultBlock; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div role="alert"><p>Unable to render this result. Original payload:</p><Json block={{ ...this.props.block, data: this.props.block, title: 'Original result' }} /></div> : this.props.children
  }
}

export function ResultRenderer(props: ResultProps) {
  return <RenderBoundary key={JSON.stringify(props.block)} block={props.block}><ResultContent {...props} /></RenderBoundary>
}

function ResultContent(props: ResultProps) {
  const { block, onExpand, onAction } = props
  const Custom = renderers.get(block.kind)
  // Registered components are stable module-level references, not generated functions.
  // eslint-disable-next-line react-hooks/static-components
  if (Custom) return <Custom {...props} />
  if (block.kind === 'vega' || block.kind === 'vega-lite') return <Suspense fallback={<p role="status">Loading visualization…</p>}><ChartVisual block={block} /></Suspense>
  if (block.kind === 'svg') return <Suspense fallback={<p role="status">Loading visualization…</p>}><SvgVisual block={block} /></Suspense>
  if (block.kind === 'dashboard' && block.children) return <section className="declarative-dashboard"><h3>{block.title}</h3><div className="declarative-grid" style={{ gridTemplateColumns: `repeat(${block.columns || 2}, minmax(0, 1fr))` }}>{block.children.map((child) => <ResultRenderer key={child.id} block={child} onAction={onAction} />)}</div></section>
  const url = safeUrl(block.url)
  if (block.kind === 'a2ui-v1' && block.surfaceId) return <V1Surface surfaceId={block.surfaceId} />
  if (block.kind === 'surface-delete') return null
  if (block.kind === 'a2ui' && block.surface) return <div className="result-a2ui"><A2UIRenderer key={JSON.stringify(block.surface)} surface={block.surface} onAction={onAction} />{onExpand && <button className="expand-result" onClick={onExpand}><Maximize2 size={13} /> Open canvas</button>}</div>
  if (block.kind === 'image' && url) return <figure className="media-result"><img src={url} alt={block.name || 'Agent result'} /><figcaption>{block.name}</figcaption></figure>
  if (block.kind === 'audio' && url) return <div className="media-result"><strong>{block.name}</strong><audio src={url} controls /></div>
  if (block.kind === 'video' && url) return <div className="media-result"><video src={url} controls /><strong>{block.name}</strong></div>
  if (block.kind === 'file' && url) return <a className="file-result" href={url} download={block.name} target="_blank" rel="noreferrer"><File size={20} /><span><strong>{block.name || 'Artifact'}</strong><small>{block.mimeType}</small></span><Download size={16} /></a>
  if (block.kind === 'error') return <div className="error-result" role="alert"><AlertTriangle size={17} /><span>{block.text}</span></div>
  if (block.kind === 'chart') return <Chart {...props} />
  if (block.kind === 'metric') return <article className="metric-card"><span>{block.title}</span><strong>{block.text}</strong></article>
  if (block.kind === 'table' && Array.isArray(block.data)) {
    const rows = block.data.filter((row) => row && typeof row === 'object') as Record<string, unknown>[]
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    return <div className="result-table"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
  }
  if (['text', 'markdown', 'status'].includes(block.kind)) return <div className="text-result"><Markdown text={block.text || ''} /></div>
  return <Json {...props} />
}
