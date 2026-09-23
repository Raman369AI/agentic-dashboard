export type ChartEngine = 'vega' | 'vega-lite'
export type ChartControl = { name: string; label: string; input: 'range' | 'select' | 'checkbox'; value: unknown; min?: number; max?: number; step?: number; options?: (string | number | boolean)[] }
export type ChartRequest = { engine: ChartEngine; spec: Record<string, unknown>; values: Record<string, unknown> }
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const forbidden = new Set(['__proto__', 'constructor', 'prototype', 'url', 'href'])
export const MAX_SPEC_BYTES = 2 * 1024 * 1024

/** Inspect JSON before any third-party compiler; no remote schemas or data are fetched. */
export function validateSpec(spec: unknown): asserts spec is Record<string, unknown> {
  if (!object(spec)) throw new Error('A visualization spec must be a JSON object.')
  if (new TextEncoder().encode(JSON.stringify(spec)).length > MAX_SPEC_BYTES) throw new Error('Visualization exceeds the 2 MiB limit.')
  let nodes = 0
  function visit(value: unknown, depth: number) {
    if (++nodes > 100_000 || depth > 40) throw new Error('Visualization is too large or deeply nested.')
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return }
    if (!object(value)) return
    for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error('Unsafe or external visualization field: ' + key + '. Supply inline data.')
      if (key === 'width' || key === 'height') {
        if (typeof item === 'number' && (!Number.isFinite(item) || item < 0 || item > 4096)) throw new Error('Visual dimensions must be between 0 and 4096.')
      }
      visit(item, depth + 1)
    }
  }
  visit(spec, 0)
}

export function chartControls(spec: Record<string, unknown>, engine: ChartEngine): ChartControl[] {
  const entries = spec[engine === 'vega' ? 'signals' : 'params']
  if (!Array.isArray(entries)) return []
  const controls: ChartControl[] = []
  for (const item of entries) {
    if (!object(item)) continue
    if (item.select || item.on) throw new Error('Pointer/event-driven charts are not supported in the worker view. Use bound value controls or A2UI interactions.')
    if (!object(item.bind)) continue
    const bind = item.bind
    if (typeof item.name !== 'string' || !/^[a-zA-Z_][\w]*$/.test(item.name) || forbidden.has(item.name)) throw new Error('Invalid bound parameter name.')
    if (!['range', 'select', 'checkbox'].includes(String(bind.input))) throw new Error('Supported chart bindings are range, select and checkbox. Use A2UI for other controls.')
    const control: ChartControl = { name: item.name, label: typeof bind.name === 'string' ? bind.name : item.name, input: bind.input as ChartControl['input'], value: item.value }
    if (bind.input === 'range') {
      if (typeof bind.min !== 'number' || typeof bind.max !== 'number' || !Number.isFinite(bind.min) || !Number.isFinite(bind.max) || bind.max <= bind.min) throw new Error('Range controls need finite min and max.')
      control.min = bind.min; control.max = bind.max
      control.step = typeof bind.step === 'number' && Number.isFinite(bind.step) && bind.step > 0 ? bind.step : (bind.max - bind.min) / 100
    } else if (bind.input === 'select') {
      if (!Array.isArray(bind.options) || !bind.options.length || bind.options.length > 100 || !bind.options.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) throw new Error('Select controls need 1–100 scalar options.')
      control.options = bind.options as ChartControl['options']
    }
    if (controls.some((v) => v.name === control.name)) throw new Error('Duplicate chart control.')
    validateControlValue(control, control.value)
    controls.push(control)
    if (controls.length > 20) throw new Error('At most 20 chart controls are allowed.')
  }
  return controls
}

export function validateControlValue(control: ChartControl, value: unknown) {
  if (control.input === 'range' && (typeof value !== 'number' || !Number.isFinite(value) || value < control.min! || value > control.max!)) throw new Error('Invalid range value.')
  if (control.input === 'select' && !control.options!.includes(value as string)) throw new Error('Invalid select value.')
  if (control.input === 'checkbox' && typeof value !== 'boolean') throw new Error('Invalid checkbox value.')
}
