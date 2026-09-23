/* eslint-disable @typescript-eslint/no-explicit-any -- Protocol JSON is schema-validated before use. */
import { absolutePath, readPath, writePath } from './data'
import { basicFunctions, parser, stringify, type LocalFunction } from './functions'
import { assertSafeData, basicCatalog, BASIC_CATALOG_ID, componentValidator, record, SPEC_BASE, validateWire, wireValidator, type JsonMap } from './schema'

export const PENDING = Symbol('A2UI pending')
export type Scope = { path: string; index?: number }
export type RuntimeContext = Scope & { surfaceId?: string; owner: string; catalogId?: string; activation?: boolean; caller?: 'agent' | 'renderer'; invocationId?: string; depth?: number }
export type UiDelivery = { message: JsonMap; metadata: JsonMap; owner: string }
export type CatalogRegistration = { definition: JsonMap; functions?: Record<string, LocalFunction> }
type Catalog = CatalogRegistration & { validator: ReturnType<typeof componentValidator> }
type Invocation = { value: unknown; error?: Error; promise?: Promise<unknown>; surfaceId?: string }
type PendingRpc = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; owner: string; surfaceId?: string; returnType?: string }
const registrations: CatalogRegistration[] = [{ definition: basicCatalog, functions: basicFunctions }]
export function registerA2UICatalog(registration: CatalogRegistration) { registrations.push(registration) }
export class A2UIError extends Error {
  constructor(message: string, readonly code = 'VALIDATION_FAILED', readonly path = '/') { super(message) }
}
export class Surface {
  components = new Map<string, JsonMap>()
  data: unknown = {}
  metadata: JsonMap = {}
  constructor(readonly id: string, readonly owner: string, readonly catalogId: string | undefined, readonly sendDataModel: boolean) {}
}

export class A2UIRuntime {
  readonly surfaces = new Map<string, Surface>()
  readonly catalogs = new Map<string, Catalog>()
  readonly errors: JsonMap[] = []
  private listeners = new Set<() => void>()
  private metadataListeners = new Set<(surfaceId: string, componentId?: string) => void>()
  private pending = new Map<string, PendingRpc>()
  private invocations = new Map<string, Invocation>()
  private reported = new Set<string>()
  private generation = 0
  private changed = false
  private disposed = false
  private remoteIds = new Set<string>()
  private revision = 0
  onSend?: (delivery: UiDelivery) => Promise<void> | void
  setDelivery(handler?: (delivery: UiDelivery) => Promise<void> | void) { this.onSend = handler }
  readonly rpcTimeoutMs: number
  constructor(options: { rpcTimeoutMs?: number; catalogs?: CatalogRegistration[] } = {}) {
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 20_000
    for (const registration of [...registrations, ...(options.catalogs || [])]) this.addCatalog(registration)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.revision
  private notify() {
    if (this.changed || this.disposed) return
    this.changed = true
    queueMicrotask(() => { this.changed = false; if (!this.disposed) { this.revision++; for (const listener of this.listeners) listener() } })
  }
  addCatalog(registration: CatalogRegistration) {
    const d = registration.definition
    assertSafeData(d)
    const validate = wireValidator.getSchema(SPEC_BASE + 'catalog_definition.json')!
    if (d.protocolVersion !== '1.0' || !validate(d)) throw new Error('Invalid v1 catalog: ' + wireValidator.errorsText(validate.errors))
    if (this.catalogs.has(d.catalogId)) throw new Error('Catalog already registered: ' + d.catalogId)
    this.catalogs.set(d.catalogId, { ...registration, validator: componentValidator(d) })
  }
  capabilities(includeInline = false) {
    return { 'v1.0': { supportedCatalogIds: [...this.catalogs.keys()], ...(includeInline ? { inlineCatalogs: [...this.catalogs.values()].map((catalog) => catalog.definition) } : {}) } }
  }
  metadata(owner: string) {
    const surfaces = Object.fromEntries([...this.surfaces.values()].filter((s) => s.owner === owner && s.sendDataModel).map((s) => [s.id, structuredClone(s.data)]))
    return { a2uiRendererCapabilities: this.capabilities(), ...(Object.keys(surfaces).length ? { a2uiRendererDataModel: { version: 'v1.0', surfaces } } : {}) }
  }
  getMetadata(surfaceId: string, componentId?: string) {
    const s = this.surface(surfaceId)
    return structuredClone(componentId ? s.components.get(componentId)?.metadata || {} : s.metadata)
  }
  setMetadata(surfaceId: string, metadata: JsonMap, componentId?: string) {
    assertSafeData(metadata)
    const validate = wireValidator.compile({ $ref: SPEC_BASE + 'common_types.json#/$defs/ComponentCommon/properties/metadata' })
    if (!validate(metadata)) throw new A2UIError('Invalid metadata.')
    const s = this.surface(surfaceId)
    if (componentId) { const c = s.components.get(componentId); if (!c) throw new A2UIError('Component not found.'); c.metadata = structuredClone(metadata) }
    else s.metadata = structuredClone(metadata)
    for (const listener of this.metadataListeners) listener(surfaceId, componentId)
    this.notify()
  }
  onMetadataChanged(listener: (surfaceId: string, componentId?: string) => void) { this.metadataListeners.add(listener); return () => this.metadataListeners.delete(listener) }
  private surface(id: string, owner?: string) {
    const s = this.surfaces.get(id)
    if (!s || (owner && s.owner !== owner)) throw new A2UIError('Surface not found for this agent: ' + id)
    return s
  }
  private catalog(id?: string): Catalog {
    const c = id && this.catalogs.get(id)
    if (!c) throw new A2UIError('No negotiated catalog: ' + String(id))
    return c
  }
  async emit(message: JsonMap, owner: string) {
    validateWire(message, 'renderer_to_agent')
    const generation = this.generation
    return Promise.resolve().then(async () => {
      if (this.disposed || generation !== this.generation) throw new Error('A2UI session closed.')
      if (!this.onSend) throw new Error('A2UI return channel is not connected.')
      await this.onSend({ message, owner, metadata: this.metadata(owner) })
    })
  }
  report(error: unknown, owner: string, surfaceId?: string, functionCallId?: string) {
    const e = error instanceof Error ? error : new Error(String(error))
    const payload = { code: error instanceof A2UIError ? error.code : 'EXECUTION_FAILED', message: e.message, ...(functionCallId ? { functionCallId } : surfaceId ? { surfaceId, path: error instanceof A2UIError ? error.path : '/' } : {}) }
    const key = JSON.stringify(payload)
    if (this.reported.has(key)) return
    this.reported.add(key); this.errors.push(payload); this.notify()
    if (this.reported.size <= 50) void this.emit({ version: 'v1.0', error: payload }, owner).catch(() => undefined)
  }
  process(message: unknown, owner: string): string[] {
    if (this.disposed) return []
    let surfaceId: string | undefined
    let functionCallId: string | undefined
    try {
      assertSafeData(message)
      if (record(message)) {
        const payload = Object.entries(message).find(([key]) => key !== 'version')?.[1]
        surfaceId = record(payload) && typeof payload.surfaceId === 'string' ? payload.surfaceId : undefined
        functionCallId = record(payload) && typeof payload.functionCallId === 'string' ? payload.functionCallId : undefined
      }
      validateWire(message, 'agent_to_renderer')
      const m = message as JsonMap
      if (m.createSurface) {
        const op = m.createSurface
        if (this.surfaces.has(op.surfaceId)) throw new A2UIError('Surface already exists: ' + op.surfaceId)
        if (this.surfaces.size >= 64) throw new A2UIError('Surface limit exceeded.')
        if (op.catalogId) this.catalog(op.catalogId)
        const s = new Surface(op.surfaceId, owner, op.catalogId, op.sendDataModel === true)
        s.data = structuredClone(op.dataModel || {}); s.metadata = structuredClone(op.metadata || {})
        s.components = this.prepareComponents(s, op.components || [])
        this.surfaces.set(s.id, s)
      } else if (m.updateComponents) {
        const s = this.surface(m.updateComponents.surfaceId, owner)
        s.components = this.prepareComponents(s, m.updateComponents.components)
      } else if (m.updateDataModel) {
        const op = m.updateDataModel
        const s = this.surface(op.surfaceId, owner)
        s.data = writePath(s.data, op.path || '/', op.value, true)
      } else if (m.deleteSurface) {
        const s = this.surface(m.deleteSurface.surfaceId, owner)
        this.surfaces.delete(s.id)
        this.clearPending('Surface deleted.', s.id)
      } else if (m.callRendererFunction) {
        const op = m.callRendererFunction
        if (this.remoteIds.has(op.functionCallId)) throw new A2UIError('Duplicate function call ID.', 'INVALID_FUNCTION_CALL')
        this.remoteIds.add(op.functionCallId)
        void this.rendererCall(op, owner)
      } else if (m.agentFunctionResponse) {
        const op = m.agentFunctionResponse
        const pending = this.pending.get(op.functionCallId)
        if (!pending || pending.owner !== owner) throw new A2UIError('Unknown function response ID.', 'INVALID_FUNCTION_CALL')
        this.pending.delete(op.functionCallId); clearTimeout(pending.timer)
        if (op.error) pending.reject(new Error(op.error.code + ': ' + op.error.message))
        else {
          try { this.checkReturnType(op.value, pending.returnType); pending.resolve(op.value) }
          catch (e) { pending.reject(e as Error) }
        }
      }
      this.notify()
      return surfaceId ? [surfaceId] : []
    } catch (error) { this.report(error, owner, surfaceId, functionCallId); return [] }
  }
  private prepareComponents(surface: Surface, updates: JsonMap[]) {
    const next = new Map(surface.components)
    const ids = new Set<string>()
    for (const component of updates) {
      if (ids.has(component.id)) throw new A2UIError('Duplicate component ID in update.')
      ids.add(component.id)
      const c = this.catalog(component.catalogId ?? surface.catalogId)
      if (!c.definition.components?.[component.component]) throw new A2UIError('Unknown component: ' + component.component)
      c.validator.component(component.component, component)
      next.set(component.id, structuredClone(component))
    }
    if (next.size > 2000) throw new A2UIError('Component limit exceeded.')
    const visit = (id: string, parent?: JsonMap, ancestors: string[] = []) => {
      const node = next.get(id)
      if (!node) return // Progressive references are valid.
      if (ancestors.includes(id) || ancestors.length > 64) throw new A2UIError('Cyclic or excessively deep component tree.')
      const definition = this.catalog(node.catalogId ?? surface.catalogId).definition.components[node.component]
      const parentType = parent?.component || 'Surface'
      if (node.weight !== undefined && !['Row', 'Column'].includes(parentType)) throw new A2UIError('weight requires a Row or Column parent.', 'VALIDATION_FAILED', '/components/' + id + '/weight')
      if (definition.allowedParents && !definition.allowedParents.includes(parentType)) throw new A2UIError(node.component + ' is not allowed under ' + parentType, 'UNALLOWED_PARENT', '/components/' + id)
      if (parent) {
        const parentDefinition = this.catalog(parent.catalogId ?? surface.catalogId).definition.components[parent.component]
        if (parentDefinition.allowedChildren && !parentDefinition.allowedChildren.includes(node.component)) throw new A2UIError(node.component + ' is not allowed inside ' + parentType, 'UNALLOWED_CHILD', '/components/' + id)
      }
      for (const child of this.childReferences(definition, node, this.catalog(node.catalogId ?? surface.catalogId).definition)) visit(child, node, [...ancestors, id])
    }
    visit('root')
    return next
  }
  childReferences(schema: JsonMap, value: any, catalog?: JsonMap, refs: string[] = []): string[] {
    const ref = String(schema.$ref || '')
    if (ref.endsWith('/ComponentId') || ref.endsWith('/Child')) return typeof value === 'string' ? [value] : []
    if (ref.endsWith('/ChildList')) return Array.isArray(value) ? value : record(value) && typeof value.componentId === 'string' ? [value.componentId] : []
    if (ref.startsWith('#/') && catalog && !refs.includes(ref)) {
      const target = readPath(catalog, ref.slice(1))
      if (record(target)) return this.childReferences(target, value, catalog, [...refs, ref])
    }
    if (refs.length > 64) throw new A2UIError('Schema reference depth exceeded.')
    return [
      ...[...(schema.allOf || []), ...(schema.oneOf || []), ...(schema.anyOf || [])].flatMap((part: JsonMap) => this.childReferences(part, value, catalog, refs)),
      ...Object.entries(schema.properties || {}).flatMap(([key, part]) => this.childReferences(part as JsonMap, value?.[key], catalog, refs)),
      ...(schema.items && Array.isArray(value) ? value.flatMap((item) => this.childReferences(schema.items, item, catalog, refs)) : []),
    ]
  }
  updateInput(surfaceId: string, binding: unknown, value: unknown, scope: Scope) {
    if (!record(binding) || typeof binding.path !== 'string') return
    const s = this.surface(surfaceId)
    s.data = writePath(s.data, absolutePath(binding.path, scope.path), value)
    this.notify()
  }
  resolve(value: unknown, context: RuntimeContext): any {
    const depth = context.depth || 0
    if (depth > 48) throw new A2UIError('Expression nesting limit exceeded.')
    const ctx = { ...context, depth: depth + 1 }
    if (Array.isArray(value)) { const items = value.map((v) => this.resolve(v, ctx)); return items.includes(PENDING) ? PENDING : items }
    if (!record(value)) return value
    if (typeof value.path === 'string' && Object.keys(value).length === 1) return context.surfaceId ? readPath(this.surface(context.surfaceId, context.owner).data, absolutePath(value.path, context.path)) : undefined
    if (typeof value.call === 'string') return this.invoke(value, ctx)
    const pairs = Object.entries(value).map(([key, val]) => [key, this.resolve(val, ctx)] as const)
    return pairs.some(([, val]) => val === PENDING) ? PENDING : Object.fromEntries(pairs)
  }
  private invoke(call: JsonMap, context: RuntimeContext): unknown {
    const args = this.resolve(call.args || {}, context)
    if (args === PENDING) return PENDING
    if (call.call === '@index') {
      if (context.caller === 'agent' || context.index === undefined) throw new A2UIError('@index requires a collection scope.', 'INVALID_FUNCTION_CALL')
      if (Object.keys(args).some((key) => key !== 'offset') || (args.offset !== undefined && typeof args.offset !== 'number')) throw new A2UIError('Invalid @index offset.', 'INVALID_FUNCTION_CALL')
      return context.index + (args.offset || 0)
    }
    const surface = context.surfaceId ? this.surface(context.surfaceId, context.owner) : undefined
    const catalogId = call.catalogId ?? context.catalogId ?? surface?.catalogId
    if (!catalogId || !this.catalogs.has(catalogId)) throw new A2UIError('No negotiated function catalog: ' + catalogId, 'INVALID_FUNCTION_CALL')
    const catalog = this.catalog(catalogId)
    const definition = catalog.definition.functions?.[call.call]
    const implementation = catalog.functions?.[call.call]
    const caller = definition?.allowedCallers || 'rendererOnly'
    if ((context.caller === 'agent' && (!implementation || caller === 'rendererOnly')) || (context.caller !== 'agent' && caller === 'agentOnly')) throw new A2UIError('Function execution boundary rejects ' + call.call, 'INVALID_FUNCTION_CALL')
    if (definition?.requiresUserActivation && !context.activation) throw new A2UIError('Function requires user activation.', 'INVALID_FUNCTION_CALL')
    if (definition) {
      try { catalog.validator.fn(call.call, { call: call.call, args: call.args, ...(call.catalogId ? { catalogId: call.catalogId } : {}) }) }
      catch (error) { throw new A2UIError((error as Error).message, 'INVALID_FUNCTION_CALL') }
    }
    if (call.call === 'formatString' && catalogId === BASIC_CATALOG_ID) {
      const parts = parser.parse(String(args.value ?? '')).map((part) => this.resolve(part, context))
      return parts.includes(PENDING) ? PENDING : parts.map(stringify).join('')
    }
    // User activation functions must never be memoized or deferred out of their gesture.
    if (definition?.requiresUserActivation && implementation) return implementation(args, { activation: !!context.activation, resolve: (v) => this.resolve(v, context) })
    const key = JSON.stringify([context.owner, context.surfaceId, context.path, catalogId, call.call, args, context.caller || 'renderer', context.invocationId])
    const cached = this.invocations.get(key)
    if (cached) { if (cached.error) throw cached.error; return cached.value }
    const slot: Invocation = { value: PENDING, surfaceId: context.surfaceId }
    if (this.invocations.size >= 2000) throw new A2UIError('Function invocation limit exceeded.')
    this.invocations.set(key, slot)
    try {
      const value = implementation
        ? implementation(args, { activation: !!context.activation, resolve: (v) => this.resolve(v, context) })
        : this.requestAgentFunction({ call: call.call, catalogId, args }, context, definition?.returnType)
      if (value instanceof Promise) {
        slot.promise = value.then((result) => { this.checkReturnType(result, definition?.returnType); slot.value = result; this.notify(); return result }).catch((error) => { slot.error = error; slot.value = null; this.report(error, context.owner, context.surfaceId); this.notify(); return null })
        return PENDING
      }
      this.checkReturnType(value, definition?.returnType); slot.value = value
      return value
    } catch (error) { slot.error = error as Error; slot.value = null; throw error }
  }
  private checkReturnType(value: unknown, type?: string) {
    if (!type || type === 'any' || (type === 'void' && value == null)) return
    const valid = type === 'array' ? Array.isArray(value) : type === 'object' ? record(value) : type === 'validationResult' ? record(value) && typeof value.valid === 'boolean' && (!value.severity || ['error', 'warning', 'info'].includes(value.severity)) : typeof value === type
    if (!valid) throw new A2UIError('Function returned an invalid ' + type + ' value.', 'EXECUTION_FAILED')
  }
  private requestAgentFunction(callFunction: JsonMap, context: RuntimeContext, returnType?: string) {
    if (!context.surfaceId) throw new A2UIError('Remote renderer call has no surface.', 'INVALID_FUNCTION_CALL')
    const functionCallId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(functionCallId); reject(new Error('Agent function timed out.')) }, this.rpcTimeoutMs)
      this.pending.set(functionCallId, { resolve, reject, timer, surfaceId: context.surfaceId, owner: context.owner, returnType })
      void this.emit({ version: 'v1.0', callAgentFunction: { surfaceId: context.surfaceId, functionCallId, callFunction } }, context.owner).catch((error) => { clearTimeout(timer); this.pending.delete(functionCallId); reject(error) })
    })
  }
  private async resolveAsync(value: unknown, context: RuntimeContext): Promise<any> {
    const deadline = Date.now() + this.rpcTimeoutMs
    for (;;) {
      const result = this.resolve(value, context)
      if (result !== PENDING) return result
      const pending = [...this.invocations.values()].filter((slot) => slot.value === PENDING && slot.promise).map((slot) => slot.promise!)
      if (!pending.length || Date.now() > deadline) throw new Error('Function resolution timed out.')
      await Promise.race(pending)
    }
  }
  private async rendererCall(op: JsonMap, owner: string) {
    try {
      const value = await this.resolveAsync(op.callFunction, { owner, path: '', caller: 'agent', invocationId: op.functionCallId })
      await this.emit({ version: 'v1.0', rendererFunctionResponse: { functionCallId: op.functionCallId, value: value ?? null } }, owner)
    } catch (error) { this.report(error, owner, undefined, op.functionCallId) }
  }
  async action(surfaceId: string, componentId: string, scope: Scope, activation: boolean) {
    const surface = this.surface(surfaceId)
    const node = surface.components.get(componentId)
    if (!node) return
    const ctx = { ...scope, surfaceId, owner: surface.owner, catalogId: surface.catalogId, activation, invocationId: crypto.randomUUID() }
    try {
      const checks = this.checks(node, { ...ctx, invocationId: undefined, activation: false })
      if (!checks.valid) return
      if (node.action?.functionCall) { await this.resolveAsync(node.action.functionCall, ctx); return }
      if (node.action?.event) {
        const resolved = await this.resolveAsync(node.action.event, ctx)
        const action = { name: resolved.name, ...(resolved.userMessage ? { userMessage: resolved.userMessage } : {}), context: resolved.context || {}, surfaceId, sourceComponentId: componentId, timestamp: new Date().toISOString() }
        await this.emit({ version: 'v1.0', action }, surface.owner)
      }
    } catch (error) { this.report(error, surface.owner, surfaceId) }
  }
  checks(node: JsonMap, context: RuntimeContext) {
    let pending = false
    const messages: string[] = []
    for (const check of node.checks || []) {
      try {
        const result = this.resolve(check.condition, context)
        if (result === PENDING) { pending = true; continue }
        const valid = record(result) ? result.valid === true : result === true
        if (!valid) messages.push(record(result) && result.message || check.message || 'Validation failed.')
      } catch (error) { messages.push(check.message || (error as Error).message) }
    }
    return { valid: !pending && !messages.length, pending, messages }
  }
  private clearPending(reason: string, surfaceId?: string) {
    for (const [id, call] of this.pending) if (!surfaceId || call.surfaceId === surfaceId) { clearTimeout(call.timer); call.reject(new Error(reason)); this.pending.delete(id) }
    for (const [key, slot] of this.invocations) if (!surfaceId || slot.surfaceId === surfaceId) this.invocations.delete(key)
  }
  dispose() { this.disposed = true; this.generation++; this.clearPending('A2UI session closed.'); this.listeners.clear(); this.metadataListeners.clear(); this.surfaces.clear() }
  export() { return [...this.surfaces.values()].map((s) => ({ surfaceId: s.id, catalogId: s.catalogId, components: [...s.components.values()], dataModel: s.data, metadata: s.metadata, sendDataModel: s.sendDataModel })) }
}
