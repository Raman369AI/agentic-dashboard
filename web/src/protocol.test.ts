import { describe, expect, test } from 'vitest'
import { normalizeResult } from './protocol'

describe('normalizeResult', () => {
  test('unwraps A2A text and image parts', () => {
    const result = normalizeResult({
      task: {
        artifacts: [{
          parts: [
            { root: { kind: 'text', text: 'Analysis complete' } },
            { root: { kind: 'file', file: { name: 'chart.png', mimeType: 'image/png', uri: 'https://example.com/chart.png' } } },
          ],
        }],
      },
    }, 'remote-agent')

    expect(result.map((block) => block.kind)).toEqual(['text', 'image'])
    expect(result[0]).toMatchObject({ text: 'Analysis complete', source: 'remote-agent' })
    expect(result[1]).toMatchObject({ name: 'chart.png', url: 'https://example.com/chart.png' })
  })

  test('turns structured rows into a table', () => {
    const result = normalizeResult([{ region: 'North', revenue: 42 }, { region: 'West', revenue: 35 }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'table' })
  })

  test('assembles streamed A2UI operations into one surface', () => {
    const result = normalizeResult([
      { createSurface: { surfaceId: 'sales' } },
      { updateComponents: { surfaceId: 'sales', components: [{ id: 'title', component: 'Text', text: 'Sales' }] } },
      { updateDataModel: { surfaceId: 'sales', data: { total: 77 } } },
    ])

    expect(result).toHaveLength(1)
    const block = result[0]
    expect(block?.kind).toBe('a2ui')
    if (block?.kind === 'a2ui' && block.surface) {
      expect(block.surface.surfaceId).toBe('sales')
      expect(block.surface.components).toHaveLength(1)
      expect(block.surface.data).toEqual({ total: 77 })
    }
  })

  test('keeps unknown plug-in payloads inspectable', () => {
    const result = normalizeResult({ nested: { arbitrary: true }, score: 0.98 })
    expect(result[0]).toMatchObject({ kind: 'json', title: 'Structured result' })
  })
})
