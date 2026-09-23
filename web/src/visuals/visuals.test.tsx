import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultRenderer } from '../components/ResultRenderer'
import { normalizeResult } from '../protocol'

describe('declarative visuals across the result pipeline', () => {
  it('renders a novel domain visual using its presentation, without registration', async () => {
    const payload = { kind: 'vendor.factory', machines: [1, 2], presentation: { kind: 'svg', title: 'Factory floor', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="1" y="1" width="50" height="30"/><text y="45">Assembly</text></svg>' } }
    const block = normalizeResult(payload)[0]
    expect(block.kind).toBe('svg')
    expect(block.original).toEqual(payload)
    render(<ResultRenderer block={block} />)
    expect(await screen.findByRole('img', { name: 'Factory floor' })).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
    expect(screen.getByRole('link', { name: 'Download SVG' })).toHaveAttribute('download')
  })
  it('composes arbitrary visual blocks and existing results in a dashboard', async () => {
    const block = normalizeResult({ kind: 'dashboard', columns: 2, children: [
      { kind: 'metric', label: 'Revenue', value: 23 },
      { kind: 'svg', title: 'Gauge', svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>' },
    ] })[0]
    render(<ResultRenderer block={block} />)
    expect(screen.getByText('Revenue')).toBeVisible()
    expect(await screen.findByRole('img', { name: 'Gauge' })).toBeVisible()
  })
  it('retains unsafe payloads as an explicit diagnostic, not a blank visual', async () => {
    render(<ResultRenderer block={normalizeResult({ kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' })[0]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported SVG element: script')
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('recognizes native Vega-Lite schemas and MIME envelopes', () => {
    expect(normalizeResult({ $schema: 'https://vega.github.io/schema/vega-lite/v6.json', mark: 'bar' })[0].kind).toBe('vega-lite')
    expect(normalizeResult({ mimeType: 'application/vnd.vega.v6+json', data: { marks: [] } })[0].kind).toBe('vega')
    expect(normalizeResult([{ type: 'svg', svg: 'bad' }])[0].kind).toBe('svg')
  })
})
