import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionInput, hasStructuredInput } from './ConnectionInput'
import type { ConnectionRecord } from '../connection-types'

const connection: ConnectionRecord = {
  id: 'test', name: 'Custom', kind: 'vendor.new', url: 'https://example.com',
  discovery: {
    verified: true,
    adapter: { kind: 'vendor.new', label: 'Vendor', contractVersion: '1.0', capabilities: ['structuredInput', 'operations'], configSchema: {} },
    tools: [{ name: 'query', requiresConfirmation: true, method: 'POST', inputSchema: {
      type: 'object', properties: { body: { type: 'object', properties: { region: { type: 'string' }, active: { type: 'boolean' }, values: { type: 'array' } } } },
    } }, { name: 'unsupported', available: false, reason: 'Needs an adapter', inputSchema: {} }],
  },
}

describe('schema-driven operation inputs', () => {
  it('recognizes new adapter kinds by capabilities and renders nested inputs', () => {
    expect(hasStructuredInput(connection)).toBeTruthy()
    const onInput = vi.fn()
    render(<ConnectionInput connection={connection} tool="query" onTool={vi.fn()} input="{}" onInput={onInput} confirmed={false} onConfirmed={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('region'), { target: { value: 'West' } })
    expect(JSON.parse(onInput.mock.calls[0][0])).toEqual({ body: { region: 'West' } })
    expect(screen.getByRole('checkbox', { name: /Confirm POST/ })).not.toBeChecked()
    expect(screen.getByRole('option', { name: 'unsupported (unavailable)' })).toBeDisabled()
    expect(screen.getByText('Edit this field in the JSON input below.')).toBeInTheDocument()
  })

  it('keeps a lossless raw editor when input is temporarily invalid', () => {
    const onInput = vi.fn()
    render(<ConnectionInput connection={connection} tool="query" onTool={vi.fn()} input="{" onInput={onInput} confirmed={false} onConfirmed={vi.fn()} />)
    const editor = screen.getByLabelText('Query input (JSON)')
    expect(editor).toHaveValue('{')
    fireEvent.change(editor, { target: { value: '{"body":{"values":[1,2]}}' } })
    expect(onInput).toHaveBeenCalledWith('{"body":{"values":[1,2]}}')
  })
})
