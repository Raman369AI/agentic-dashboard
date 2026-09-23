import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultRenderer, registerResultRenderer } from './ResultRenderer'
import { normalizeResult } from '../protocol'

describe('result rendering', () => {
  it('preserves malformed results without crashing the client', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<ResultRenderer block={{ id: 'broken', kind: 'a2ui', surface: { surfaceId: 'broken', components: [{ id: 'root', component: 'ChoicePicker', options: [null] }] } }} />)
      expect(screen.getByRole('alert')).toHaveTextContent('Original payload')
      expect(screen.getByText(/"options"/)).toBeVisible()
    } finally { log.mockRestore() }
  })
  it('allows trusted custom result renderers with a JSON fallback', () => {
    const block = normalizeResult({ kind: 'vendor.map', location: 'Chicago' })[0]
    expect(block.kind).toBe('vendor.map')
    registerResultRenderer('vendor.map', ({ block }) => <p>Custom map: {String((block.data as Record<string, unknown>).location)}</p>)
    render(<ResultRenderer block={block} />)
    expect(screen.getByText('Custom map: Chicago')).toBeVisible()
  })
})
