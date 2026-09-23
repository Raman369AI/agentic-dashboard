import type { ChartRequest } from './contract'

// Bound concurrent compilers and terminate workers on completion, cancellation or timeout.
let active = 0
const queue: (() => void)[] = []
function drain() { while (active < 2 && queue.length) queue.shift()!() }

export function renderChart(request: ChartRequest, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Cancelled')); return }
    if (queue.length >= 32) { reject(new Error('Too many queued visualizations.')); return }
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let started = false
    let done = false
    const finish = (error?: string, svg?: string) => {
      if (done) return
      done = true; clearTimeout(timer); worker?.terminate(); signal.removeEventListener('abort', cancel)
      if (started) active--
      else { const index = queue.indexOf(start); if (index >= 0) queue.splice(index, 1) }
      if (error) reject(new Error(error)); else resolve(svg!)
      drain()
    }
    const cancel = () => finish('Cancelled')
    const start = () => {
      started = true; active++
      try {
        worker = new Worker(new URL('./chart-worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event) => typeof event.data.svg === 'string' ? finish(undefined, event.data.svg) : finish(String(event.data.error || 'Visualization failed.'))
        worker.onerror = () => finish('Visualization worker failed to load or render.')
        timer = setTimeout(() => finish('Visualization exceeded the 8 second rendering limit.'), 8000)
        worker.postMessage(request)
      } catch (error) { finish(error instanceof Error ? error.message : 'Could not start visualization worker.') }
    }
    signal.addEventListener('abort', cancel, { once: true })
    queue.push(start); drain()
  })
}
