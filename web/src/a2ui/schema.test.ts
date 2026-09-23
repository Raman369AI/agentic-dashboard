import { describe, expect, test } from 'vitest'
import { basicCatalog, schemaValidator, SPEC_BASE, type JsonMap } from './schema'
import testing from './fixtures/testing_catalog.json'
const suites = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' }) as Record<string, JsonMap>

describe('pinned official A2UI v1 schema fixtures', () => {
  for (const [name, suite] of Object.entries(suites)) {
    if (!Array.isArray(suite.tests)) continue
    const ajv = schemaValidator(suite.catalog === 'testing_catalog.json' ? testing : basicCatalog)
    const validate = ajv.getSchema(SPEC_BASE + (suite.schema || 'agent_to_renderer.json'))!
    for (const item of suite.tests) test(name + ': ' + item.description, () => {
      expect(validate(item.data), JSON.stringify(validate.errors)).toBe(item.valid)
    })
  }
})
