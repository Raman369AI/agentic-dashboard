import { useEffect, useMemo, useState } from 'react'
import type { ResultBlock } from '../types'
import { chartControls, object, validateSpec, type ChartControl, type ChartEngine } from './contract'
import { renderChart } from './chart-client'
import { safeSvg } from './svg'

function Source({ block }: { block: ResultBlock }) {
  return <details className="visual-source"><summary>Visualization source</summary><pre>{JSON.stringify(block.original ?? block.data, null, 2)}</pre></details>
}

function Failure({ block, error }: { block: ResultBlock; error: string }) {
  return <section className="visual-result"><p role="alert">Unable to render visualization: {error}</p><Source block={block} /></section>
}

function Picture({ svg, title }: { svg: string; title: string }) {
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return <><img className="declarative-visual" src={uri} alt={title} /><a className="visual-download" href={uri} download="visualization.svg">Download SVG</a></>
}

export function SvgVisual({ block }: { block: ResultBlock }) {
  const result = useMemo(() => {
    try { return { svg: safeSvg(object(block.data) ? block.data.svg : undefined) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'Invalid SVG.' } }
  }, [block.data])
  if (result.error) return <Failure block={block} error={result.error} />
  return <figure className="visual-result"><figcaption>{block.title || 'Custom visual'}</figcaption><Picture svg={result.svg!} title={block.title || 'Custom visual'} /><Source block={block} /></figure>
}

function Control({ control, value, onChange }: { control: ChartControl; value: unknown; onChange: (value: unknown) => void }) {
  return <label>{control.label}
    {control.input === 'range' ? <><input type="range" min={control.min} max={control.max} step={control.step} value={typeof value === 'number' ? value : control.min} onChange={(event) => onChange(Number(event.target.value))} /><output>{String(value ?? control.min)}</output></>
      : control.input === 'checkbox' ? <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      : <select value={control.options!.findIndex((option) => option === value)} onChange={(event) => onChange(control.options![Number(event.target.value)])}><option value={-1} disabled>Choose…</option>{control.options!.map((option, index) => <option key={index} value={index}>{String(option)}</option>)}</select>}
  </label>
}

export function ChartVisual({ block }: { block: ResultBlock }) {
  const engine = block.kind as ChartEngine
  const parsed = useMemo(() => {
    try {
      const spec = object(block.data) ? block.data.spec : undefined
      validateSpec(spec)
      return { spec, controls: chartControls(spec, engine) }
    } catch (error) { return { error: error instanceof Error ? error.message : 'Invalid chart specification.' } }
  }, [block.data, engine])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState<{ key: string; svg?: string; error?: string }>()
  const key = JSON.stringify({ spec: parsed.spec, values })
  useEffect(() => {
    if (!parsed.spec) return
    const controller = new AbortController()
    // Debounce rapid slider changes, and cancel obsolete renders.
    const timer = setTimeout(() => {
      void renderChart({ engine, spec: parsed.spec!, values }, controller.signal).then((svg) => {
        if (!controller.signal.aborted) setResult({ key, svg: safeSvg(svg) })
      }).catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, error: error.message }) })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [parsed.spec, engine, values, key])
  if (parsed.error) return <Failure block={block} error={parsed.error} />
  const current = result?.key === key ? result : undefined
  return <figure className="visual-result" aria-busy={!current}>
    <figcaption>{block.title || 'Data visualization'}</figcaption>
    {!!parsed.controls?.length && <div className="visual-controls">{parsed.controls.map((control) => <Control key={control.name} control={control} value={values[control.name] ?? control.value} onChange={(value) => setValues((previous) => ({ ...previous, [control.name]: value }))} />)}</div>}
    {current?.error ? <p role="alert">Unable to render visualization: {current.error}</p> : current?.svg ? <Picture svg={current.svg} title={block.title || 'Data visualization'} /> : <p role="status">Rendering visualization…</p>}
    <Source block={block} />
  </figure>
}
