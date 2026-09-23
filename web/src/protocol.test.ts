import { describe, expect, test } from 'vitest'
import { normalizeResult, ResultNormalizer, safeUrl } from './protocol'

describe('result interoperability', () => {
  test('unwraps legacy A2A text and image parts', () => {
    const result = normalizeResult({ task: { artifacts: [{ parts: [
      { root: { kind: 'text', text: 'Analysis complete' } },
      { root: { kind: 'file', file: { name: 'chart.png', mimeType: 'image/png', uri: 'https://example.com/chart.png' } } },
    ] }] } }, 'remote')
    expect(result.map((block) => block.kind)).toEqual(['text', 'image'])
  })

  test('handles protobuf A2A artifact updates and raw file parts', () => {
    const result = normalizeResult({ artifactUpdate: { artifact: { parts: [
      { text: 'Report' }, { mediaType: 'image/png', filename: 'chart.png', raw: 'aGVsbG8=' },
    ] } } })
    expect(result.map((block) => block.kind)).toEqual(['text', 'image'])
  })

  test('renders row arrays as tables but heterogeneous blocks individually', () => {
    expect(normalizeResult([{ region: 'North', revenue: 42 }])[0].kind).toBe('table')
    const blocks = normalizeResult([{ type: 'text', text: 'Report' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }])
    expect(blocks.map((block) => block.kind)).toEqual(['text', 'image'])
  })

  test('merges A2UI across separate events without losing components or nested data', () => {
    const renderer = new ResultNormalizer()
    renderer.normalize({ createSurface: { surfaceId: 'sales' } })
    renderer.normalize({ updateComponents: { surfaceId: 'sales', components: [{ id: 'root', component: 'Column', children: ['title'] }] } })
    renderer.normalize({ updateComponents: { surfaceId: 'sales', components: [{ id: 'title', component: 'Text', text: { path: '/total' } }] } })
    const result = renderer.normalize({ updateDataModel: { surfaceId: 'sales', path: '/total', value: 77 } })
    expect(result[0].surface?.components).toHaveLength(2)
    expect(result[0].surface?.data).toEqual({ total: 77 })
    expect(renderer.normalize({ deleteSurface: { surfaceId: 'sales' } })[0].kind).toBe('surface-delete')
  })

  test('assembles operation arrays', () => {
    const result = normalizeResult([
      { createSurface: { surfaceId: 'sales' } },
      { updateComponents: { surfaceId: 'sales', components: [{ id: 'title', component: 'Text', text: 'Sales' }] } },
      { updateDataModel: { surfaceId: 'sales', data: { total: 77 } } },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].surface?.data).toEqual({ total: 77 })
  })

  test('preserves MCP content and structured output with errors taking priority', () => {
    const result = normalizeResult({ content: [{ type: 'text', text: 'Explanation' }], structuredContent: [{ x: 1 }] })
    expect(result.map((block) => block.kind)).toEqual(['table', 'text'])
    expect(normalizeResult({ isError: true, content: [{ type: 'text', text: 'Failure' }] })[0].kind).toBe('error')
  })

  test('keeps unknown output and data-adjacent metadata inspectable', () => {
    const payload = { data: { arbitrary: true }, metadata: { units: 'USD' } }
    expect(normalizeResult(payload)[0]).toMatchObject({ kind: 'json', data: payload })
  })

  test('blocks executable URLs and prototype data paths', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl('data:text/html;base64,dGVzdA==')).toBeUndefined()
    const renderer = new ResultNormalizer()
    renderer.normalize({ updateDataModel: { surfaceId: 'x', path: '/__proto__/injected', value: true } })
    expect('injected' in {}).toBe(false)
  })

  test('recognizes chart and metric outputs', () => {
    expect(normalizeResult({ type: 'metric', label: 'Revenue', value: 42 })[0]).toMatchObject({ kind: 'metric', text: '42' })
    expect(normalizeResult({ type: 'chart', xKey: 'x', yKey: 'y', data: [{ x: 'Q1', y: 1 }] })[0].kind).toBe('chart')
  })
})


it('unwraps connection results returned by coordinator tools', () => {
  const blocks = normalizeResult({ status: 'success', events: [
    { type: 'RUN_STARTED' },
    { type: 'CUSTOM', name: 'relay.result', value: { kind: 'metric', label: 'Revenue', value: 42 } },
    { type: 'RUN_FINISHED' },
  ] })
  expect(blocks.map((block) => block.kind)).toEqual(['metric'])
  expect(blocks[0].text).toBe('42')
})
