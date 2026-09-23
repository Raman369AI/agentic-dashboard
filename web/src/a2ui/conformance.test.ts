import { describe, expect, test, vi } from 'vitest'
import { A2UIRuntime, PENDING } from './runtime'
import { basicCatalog, BASIC_CATALOG_ID, type JsonMap } from './schema'
import { ResultNormalizer } from '../protocol'
import { writePath } from './data'

function runtime(options = {}) {
  const r = new A2UIRuntime(options)
  r.onSend = vi.fn()
  r.process({ version: 'v1.0', createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID, sendDataModel: true, components: [{ id: 'root', component: 'Text', text: 'Original' }], dataModel: { name: 'Ada' } } }, 'owner')
  return r
}
const ctx = { surfaceId: 's', owner: 'owner', path: '' }
function customCatalog() {
  const catalog = structuredClone(basicCatalog)
  catalog.catalogId = 'https://example.com/trusted'
  catalog.$id = catalog.catalogId
  catalog.functions.double = { type: 'object', allowedCallers: 'rendererOrAgent', requiresUserActivation: false, returnType: 'number', properties: { call: { const: 'double' }, args: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false } }, required: ['call', 'args'] }
  return catalog
}

describe('v1 behavioral contracts', () => {
  test.each([
    ['required', { value: [] }, { valid: false }],
    ['length', { value: 'Ada', min: 2, max: 4 }, { valid: true }],
    ['numeric', { value: 3, min: 0, max: 2 }, { valid: false }],
    ['email', { value: 'ada@example.com' }, { valid: true }],
    ['formatNumber', { value: 1234, grouping: false, decimals: 2 }, '1234.00'],
    ['formatCurrency', { value: 12, currency: 'USD', decimals: 2 }, '$12.00'],
    ['formatDate', { value: '2026-09-18', format: 'yyyy-MM-dd' }, '2026-09-18'],
    ['pluralize', { value: 2, one: 'item', other: 'items' }, 'items'],
    ['and', { values: [true, false] }, false],
    ['or', { values: [true, false] }, true],
    ['not', { value: true }, false],
  ])('%s basic function', (call, args, expected) => {
    const r = runtime()
    const actual = r.resolve({ call, args }, ctx)
    if (expected && typeof expected === 'object') expect(actual).toMatchObject(expected)
    else expect(actual).toEqual(expected)
    r.dispose()
  })
  test('batch continues after an invalid message and preserves atomic components', () => {
    const n = new ResultNormalizer()
    const blocks = n.normalize([
      { version: 'v1.0', createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID } },
      { version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'valid' }, { id: 'bad', component: 'Unknown' }] } },
      { version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'recovered' }] } },
    ])
    expect(blocks.map((block) => block.kind)).toEqual(['error', 'a2ui-v1'])
    expect(n.a2ui.surfaces.get('s')?.components.size).toBe(1)
    expect(n.a2ui.surfaces.get('s')?.components.get('root')?.text).toBe('recovered')
    n.a2ui.dispose()
  })
  test('negotiates mixed catalogs, rejects unnegotiated catalogs, and executes separate agent RPC calls', async () => {
    const double = vi.fn(({ value }) => value * 2)
    const catalog = customCatalog()
    const r = runtime({ catalogs: [{ definition: catalog, functions: { double } }] })
    expect(r.capabilities()['v1.0'].supportedCatalogIds).toContain(catalog.catalogId)
    r.process({ version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text', catalogId: catalog.catalogId, text: { call: 'formatNumber', args: { value: 12, decimals: 2 } } }] } }, 'owner')
    expect(r.errors).toEqual([])
    expect(r.resolve(r.surfaces.get('s')?.components.get('root')?.text, ctx)).toBe('12.00')
    for (const functionCallId of ['a', 'b']) r.process({ version: 'v1.0', callRendererFunction: { functionCallId, callFunction: { call: 'double', catalogId: catalog.catalogId, args: { value: 2 } } } }, 'owner')
    await vi.waitFor(() => expect(double).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(r.onSend).toHaveBeenCalledWith(expect.objectContaining({ message: { version: 'v1.0', rendererFunctionResponse: { functionCallId: 'b', value: 4 } } })))
    r.process({ version: 'v1.0', createSurface: { surfaceId: 'bad', catalogId: 'https://unknown.example/catalog' } }, 'owner')
    expect(r.surfaces.has('bad')).toBe(false)
    r.dispose()
  })
  test('rejects invalid composition atomically, including surface parent and cycles', () => {
    const catalog = customCatalog()
    catalog.components.Text.allowedParents = ['Column']
    const r = runtime({ catalogs: [{ definition: catalog }] })
    r.process({ version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text', catalogId: catalog.catalogId, text: 'invalid root' }] } }, 'owner')
    expect(r.errors.at(-1)?.code).toBe('UNALLOWED_PARENT')
    expect(r.surfaces.get('s')?.components.get('root')?.text).toBe('Original')
    r.process({ version: 'v1.0', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Column', children: ['root'] }] } }, 'owner')
    expect(r.errors.at(-1)?.message).toContain('Cyclic')
    r.dispose()
  })
  test('metadata round trips and data models remain scoped to the owning agent', () => {
    const r = runtime()
    const listener = vi.fn(); r.onMetadataChanged(listener)
    r.setMetadata('s', { extensions: { vendor: { color: 'red' } } })
    expect(listener).toHaveBeenCalledWith('s', undefined)
    expect(r.getMetadata('s')).toEqual({ extensions: { vendor: { color: 'red' } } })
    expect(r.metadata('other')).not.toHaveProperty('a2uiRendererDataModel')
    expect(() => r.resolve({ path: '/name' }, { ...ctx, owner: 'other' })).toThrow('not found')
    r.process({ version: 'v1.0', updateDataModel: { surfaceId: 's', path: '/name', value: 'stolen' } }, 'other')
    expect(r.surfaces.get('s')?.data).toEqual({ name: 'Ada' })
    r.dispose()
  })
  test('async validation is reused by submit, not restarted under a new action id', async () => {
    const r = runtime()
    const catalog = r.catalogs.get(BASIC_CATALOG_ID)!
    const check = vi.fn(async () => ({ valid: true }))
    catalog.functions = { ...catalog.functions, regex: check }
    const node: JsonMap = { id: 'root', component: 'Button', child: 'label', checks: [{ condition: { call: 'regex', args: { value: 'Ada', pattern: '.' } } }], action: { event: { name: 'save' } } }
    r.process({ version: 'v1.0', updateComponents: { surfaceId: 's', components: [node, { id: 'label', component: 'Text', text: 'Save' }] } }, 'owner')
    expect(r.checks(node, ctx).pending).toBe(true)
    await vi.waitFor(() => expect(r.checks(node, ctx).valid).toBe(true))
    await r.action('s', 'root', { path: '' }, true)
    expect(check).toHaveBeenCalledTimes(1)
    expect(r.onSend).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ action: expect.objectContaining({ name: 'save' }) }) }))
    r.dispose()
  })
  test('remote calls time out and expose the failure', async () => {
    const r = runtime({ rpcTimeoutMs: 20 })
    expect(r.resolve({ call: 'lookup' }, ctx)).toBe(PENDING)
    await vi.waitFor(() => expect(r.onSend).toHaveBeenCalled())
    await vi.waitFor(() => expect(r.errors.some((error) => error.message.includes('timed out'))).toBe(true))
    expect(() => r.resolve({ call: 'lookup' }, ctx)).toThrow('timed out')
    r.dispose()
  })
  test('prevents prototype paths and sparse array resource amplification', () => {
    expect(() => writePath({}, '/__proto__/polluted', true)).toThrow('Unsafe')
    expect(() => writePath({ items: [] }, '/items/99999999/title', 'x')).toThrow('array index')
    expect({}).not.toHaveProperty('polluted')
  })
})
