import { describe, expect, test, vi } from 'vitest'
import { A2UIRuntime, PENDING } from './runtime'
import { BASIC_CATALOG_ID } from './schema'
const create = (id = 's') => ({ version: 'v1.0', createSurface: { surfaceId: id, catalogId: BASIC_CATALOG_ID, sendDataModel: true, components: [{ id: 'root', component: 'Text', text: { path: '/name' } }], dataModel: { name: 'Ada' } } })

describe('A2UI v1 runtime', () => {
  test('creates atomically, updates escaped/array pointers, deletes and rejects duplicate surfaces', () => {
    const r = new A2UIRuntime()
    r.process(create(), 'agent')
    expect(r.surfaces.get('s')?.data).toEqual({ name: 'Ada' })
    r.process(create(), 'agent')
    expect(r.errors.at(-1)?.message).toContain('already exists')
    r.process({ version: 'v1.0', updateDataModel: { surfaceId: 's', path: '/a~1b', value: [1, 2] } }, 'agent')
    r.process({ version: 'v1.0', updateDataModel: { surfaceId: 's', path: '/a~1b/0', value: null } }, 'agent')
    expect(r.surfaces.get('s')?.data).toEqual({ name: 'Ada', 'a/b': [2] })
    expect(r.metadata('other')).not.toHaveProperty('a2uiRendererDataModel')
    r.process({ version: 'v1.0', deleteSurface: { surfaceId: 's' } }, 'agent')
    expect(r.surfaces.size).toBe(0)
  })
  test('resolves local functions, validation results, nested interpolation and collection indexes', () => {
    const r = new A2UIRuntime(); r.process(create(), 'agent')
    const ctx = { surfaceId: 's', owner: 'agent', path: '', index: 2 }
    expect(r.resolve({ call: 'required', args: { value: '' } }, ctx)).toMatchObject({ valid: false })
    expect(r.resolve({ call: 'formatString', args: { value: 'Hi ${/name} #${@index(offset: 1)}' } }, ctx)).toBe('Hi Ada #3')
    expect(r.resolve({ call: 'formatString', args: { value: '${formatNumber(value: 12, decimals: 2)}' } }, ctx)).toBe('12.00')
    expect(() => r.resolve({ call: '@index' }, { ...ctx, index: undefined })).toThrow('collection')
    expect(() => r.resolve({ call: 'openUrl', args: { url: 'https://example.com' } }, ctx)).toThrow('activation')
  })
  test('sends structured actions and synchronized data, not chat prompts', async () => {
    const r = new A2UIRuntime(); const send = vi.fn(); r.onSend = send; r.process(create(), 'agent')
    r.process({ version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Button', child: 'label', action: { event: { name: 'save', context: { name: { path: '/name' } } } } }, { id: 'label', component: 'Text', text: 'Save' }] } }, 'agent')
    r.updateInput('s', { path: '/name' }, 'Grace', { path: '' })
    await r.action('s', 'root', { path: '' }, false)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ owner: 'agent', message: expect.objectContaining({ action: expect.objectContaining({ name: 'save', context: { name: 'Grace' } }) }), metadata: expect.objectContaining({ a2uiRendererDataModel: { version: 'v1.0', surfaces: { s: { name: 'Grace' } } } }) }))
  })
  test('correlates remote functions and rejects unsafe renderer calls', async () => {
    const r = new A2UIRuntime(); const send = vi.fn(); r.onSend = send; r.process(create(), 'agent')
    const ctx = { surfaceId: 's', owner: 'agent', path: '' }
    expect(r.resolve({ call: 'remoteLookup', args: { key: 1 } }, ctx)).toBe(PENDING)
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const call = send.mock.calls[0][0].message.callAgentFunction
    r.process({ version: 'v1.0', agentFunctionResponse: { functionCallId: call.functionCallId, value: 'found' } }, 'agent')
    await vi.waitFor(() => expect(r.resolve({ call: 'remoteLookup', args: { key: 1 } }, ctx)).toBe('found'))
    r.process({ version: 'v1.0', callRendererFunction: { functionCallId: 'bad', callFunction: { call: 'openUrl', catalogId: BASIC_CATALOG_ID, args: { url: 'https://example.com' } } } }, 'agent')
    await vi.waitFor(() => expect(send.mock.calls.some(([delivery]) => delivery.message.error?.code === 'INVALID_FUNCTION_CALL')).toBe(true))
    r.dispose()
  })
})
