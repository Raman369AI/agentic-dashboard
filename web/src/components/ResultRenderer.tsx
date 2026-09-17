import { AlertTriangle, Download, File, FileJson, Maximize2 } from 'lucide-react'
import type { ResultBlock } from '../types'
import { A2UIRenderer } from './A2UIRenderer'

export function ResultRenderer({ block, onExpand }: { block: ResultBlock; onExpand?: () => void }) {
  if (block.kind === 'a2ui' && block.surface) return <div className="result-a2ui"><A2UIRenderer surface={block.surface} />{onExpand && <button className="expand-result" onClick={onExpand}><Maximize2 size={13} /> Open canvas</button>}</div>
  if (block.kind === 'image' && block.url) return <figure className="media-result"><img src={block.url} alt={block.name || 'Agent result'} /><figcaption>{block.name}</figcaption></figure>
  if (block.kind === 'audio' && block.url) return <div className="media-result"><strong>{block.name}</strong><audio src={block.url} controls /></div>
  if (block.kind === 'video' && block.url) return <div className="media-result"><video src={block.url} controls /><strong>{block.name}</strong></div>
  if (block.kind === 'file') return <a className="file-result" href={block.url} download={block.name}><File size={20} /><span><strong>{block.name || 'Artifact'}</strong><small>{block.mimeType}</small></span><Download size={16} /></a>
  if (block.kind === 'error') return <div className="error-result"><AlertTriangle size={17} /><span>{block.text}</span></div>
  if (block.kind === 'table' && Array.isArray(block.data)) {
    const rows = block.data as Record<string, unknown>[]
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 12)
    return <div className="result-table"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>
  }
  if (block.kind === 'json') return <details className="json-result" open><summary><FileJson size={15} />{block.title || 'Structured result'}</summary><pre>{JSON.stringify(block.data, null, 2)}</pre></details>
  return <div className={`text-result ${block.kind}`}><p>{block.text}</p></div>
}
