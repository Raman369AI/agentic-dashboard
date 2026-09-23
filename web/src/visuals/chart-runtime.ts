import { parse, View, type Spec } from 'vega'
import { compile, type TopLevelSpec } from 'vega-lite'
import { expressionInterpreter } from 'vega-interpreter'
import { chartControls, validateControlValue, validateSpec, type ChartRequest } from './contract'

/** Called in a worker: interpreter, not eval/Function; all loader methods deny I/O. */
export async function chartSvg(request: ChartRequest): Promise<string> {
  if (!['vega', 'vega-lite'].includes(request.engine)) throw new Error('Unsupported visualization engine.')
  validateSpec(request.spec)
  const controls = chartControls(request.spec, request.engine)
  const spec = structuredClone(request.spec)
  const bindings = spec[request.engine === 'vega' ? 'signals' : 'params']
  if (Array.isArray(bindings)) for (const entry of bindings) delete entry.bind
  const compiled = request.engine === 'vega-lite' ? compile(spec as unknown as TopLevelSpec).spec : spec as Spec
  let denied = false
  const deny = async () => { denied = true; throw new Error('Visualizations cannot load external data, images or links.') }
  const view = new View(parse(compiled, undefined, { ast: true }), {
    renderer: 'none', expr: expressionInterpreter,
    loader: { load: deny, sanitize: deny, http: deny, file: deny },
  })
  try {
    for (const [name, value] of Object.entries(request.values)) {
      const control = controls.find((entry) => entry.name === name)
      if (!control) throw new Error('Unknown chart parameter.')
      validateControlValue(control, value)
      view.signal(name, value)
    }
    await view.runAsync()
    const svg = await view.toSVG()
    if (denied) throw new Error('External visualization resources are disabled.')
    if (new TextEncoder().encode(svg).length > 2 * 1024 * 1024) throw new Error('Rendered SVG exceeds the 2 MiB limit.')
    return svg
  } finally { view.finalize() }
}
