// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { chartSvg } from './chart-runtime'
import { chartControls, validateSpec } from './contract'

const spec = {
  data: { values: [{ category: 'A', value: 3 }, { category: 'B', value: 7 }] },
  mark: 'line',
  encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } },
}

describe('interpreted chart runtime', () => {
  it.each(['line', 'bar', 'point', 'area', 'rect', 'arc'])('renders %s without a renderer plugin', async (mark) => {
    const svg = await chartSvg({ engine: 'vega-lite', spec: { ...spec, mark }, values: {} })
    expect(svg).toContain('<svg')
    expect(svg).toContain('<path')
  })
  it('interprets expressions without evaluating JavaScript source', async () => {
    vi.stubGlobal('Function', function () { throw new Error('Code generation disabled') })
    try {
      const svg = await chartSvg({ engine: 'vega-lite', spec: { ...spec, transform: [{ calculate: 'datum.value * 2', as: 'doubled' }] }, values: {} })
      expect(svg).toContain('<svg')
    } finally { vi.unstubAllGlobals() }
  })
  it('updates bound value parameters and rerenders a filtered chart', async () => {
    const bound = { ...spec, params: [{ name: 'threshold', value: 0, bind: { input: 'range', min: 0, max: 10 } }], transform: [{ filter: 'datum.value >= threshold' }] }
    const initial = await chartSvg({ engine: 'vega-lite', spec: bound, values: {} })
    const updated = await chartSvg({ engine: 'vega-lite', spec: bound, values: { threshold: 9 } })
    expect(updated).not.toBe(initial)
    await expect(chartSvg({ engine: 'vega-lite', spec: bound, values: { threshold: 50 } })).rejects.toThrow('range')
    await expect(chartSvg({ engine: 'vega-lite', spec: bound, values: { arbitrary: 1 } })).rejects.toThrow('Unknown')
  })
  it('renders inline geographic data without map downloads', async () => {
    const svg = await chartSvg({ engine: 'vega-lite', spec: { data: { values: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] } }] } }, mark: 'geoshape', projection: { type: 'mercator' } }, values: {} })
    expect(svg).toContain('<path')
  })
  it('renders Vega directly, including custom marks', async () => {
    const svg = await chartSvg({ engine: 'vega', spec: { width: 120, height: 50, marks: [{ type: 'text', encode: { enter: { x: { value: 5 }, y: { value: 25 }, text: { value: 'Custom mark' } } } }] }, values: {} })
    expect(svg).toContain('Custom mark')
  })
  it.each([
    { ...spec, data: { url: 'https://example.com/private' } },
    { ...spec, encoding: { href: { value: 'javascript:alert(1)' } } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { width: 100000 },
  ])('rejects unsafe or oversized input before compilation', (bad) => {
    expect(() => validateSpec(bad)).toThrow()
  })
  it('rejects malformed and excessive controls', () => {
    expect(() => chartControls({ params: [{ name: 'x', bind: { input: 'text' } }] }, 'vega-lite')).toThrow('Supported')
    expect(() => chartControls({ params: [{ name: 'x', bind: { input: 'range', min: 10, max: 1 } }] }, 'vega-lite')).toThrow('min and max')
  })
})
