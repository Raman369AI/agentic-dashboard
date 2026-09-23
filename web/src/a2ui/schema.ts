/* eslint-disable @typescript-eslint/no-explicit-any -- JSON Schema is validated at this boundary. */
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import basic from '../../../app/a2ui_schema/basic_catalog.json'
import common from '../../../app/a2ui_schema/common_types.json'
import incoming from '../../../app/a2ui_schema/agent_to_renderer.json'
import outgoing from '../../../app/a2ui_schema/renderer_to_agent.json'
import catalogDefinition from '../../../app/a2ui_schema/catalog_definition.json'
import capabilities from '../../../app/a2ui_schema/renderer_capabilities.json'
import dataModel from '../../../app/a2ui_schema/renderer_data_model.json'

export const SPEC_BASE = 'https://a2ui.org/specification/v1_0/'
export const BASIC_CATALOG_ID = basic.catalogId
export const basicCatalog: Record<string, any> = basic
export type JsonMap = Record<string, any>
export const record = (value: unknown): value is JsonMap => !!value && typeof value === 'object' && !Array.isArray(value)
export const schemas: Record<string, JsonMap> = { 'common_types.json': common, 'agent_to_renderer.json': incoming, 'renderer_to_agent.json': outgoing, 'catalog_definition.json': catalogDefinition, 'renderer_capabilities.json': capabilities, 'renderer_data_model.json': dataModel }

export function schemaValidator(catalog: JsonMap = basicCatalog) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true })
  addFormats(ajv)
  for (const schema of Object.values(schemas)) ajv.addSchema(schema)
  ajv.addSchema({ ...catalog, $id: SPEC_BASE + 'catalog.json' })
  return ajv
}

// Envelope validation is catalog-agnostic. Each component/function is subsequently
// checked against its resolved catalog, so mixed catalogs are not incorrectly unioned.
export const envelopeCatalog = {
  $id: SPEC_BASE + 'catalog.json',
  $defs: {
    anyComponent: { type: 'object', properties: { component: { type: 'string' } }, required: ['component'], additionalProperties: true },
    anyFunction: { type: 'object', properties: { call: { type: 'string', pattern: '^[^@]' }, args: { type: 'object' } }, required: ['call'] },
  },
}
export const wireValidator = schemaValidator(envelopeCatalog)
export function validateWire(value: unknown, direction: 'agent_to_renderer' | 'renderer_to_agent') {
  const validate = wireValidator.getSchema(SPEC_BASE + direction + '.json')!
  if (!validate(value)) throw new Error(wireValidator.errorsText(validate.errors, { separator: '; ' }))
}
export function assertSafeData(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('Payload exceeds nesting limit.')
  if (Array.isArray(value)) { for (const child of value) assertSafeData(child, depth + 1); return }
  if (record(value)) for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe object key.')
    assertSafeData(child, depth + 1)
  }
}
export function componentValidator(catalog: JsonMap) {
  // Resolve local catalog refs to its schema while keeping common dynamic values open
  // to functions in other negotiated catalogs. Runtime invocation validates those.
  const ajv = schemaValidator(envelopeCatalog)
  const id = SPEC_BASE + 'local/' + encodeURIComponent(catalog.catalogId) + '.json'
  const absolutize = (value: any): any => Array.isArray(value) ? value.map(absolutize) : record(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string' && child.startsWith('common_types.json') ? SPEC_BASE + child : absolutize(child)])) : value
  ajv.addSchema({ ...absolutize(catalog), $id: id })
  return {
    component(name: string, value: unknown) {
      const ref = id + '#/components/' + name.replaceAll('~', '~0').replaceAll('/', '~1')
      const validate = ajv.compile({ allOf: [{ $ref: SPEC_BASE + 'common_types.json#/$defs/ComponentCommon' }, { $ref: ref }], unevaluatedProperties: false })
      if (!validate(value)) throw new Error(ajv.errorsText(validate.errors))
    },
    fn(name: string, value: unknown) {
      const ref = id + '#/functions/' + name.replaceAll('~', '~0').replaceAll('/', '~1')
      const validate = ajv.compile({ allOf: [{ $ref: SPEC_BASE + 'common_types.json#/$defs/FunctionCommon' }, { $ref: ref }], unevaluatedProperties: false })
      if (!validate(value)) throw new Error(ajv.errorsText(validate.errors))
    },
  }
}
