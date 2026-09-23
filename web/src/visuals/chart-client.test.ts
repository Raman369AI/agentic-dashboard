import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderChart } from './chart-client'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  reply(svg: string) { this.onmessage?.({ data: { svg } }) }
}
const request = { engine: 'vega' as const, spec: {}, values: {} }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = [] })
describe('visualization worker lifecycle', () => {
  it('limits concurrency, cancels queued work, and cleans up completed workers', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controllers = [new AbortController(), new AbortController(), new AbortController()]
    const first = renderChart(request, controllers[0].signal)
    const second = renderChart(request, controllers[1].signal)
    const third = renderChart(request, controllers[2].signal).catch((error: Error) => error.message)
    expect(FakeWorker.instances).toHaveLength(2)
    controllers[2].abort()
    expect(await third).toBe('Cancelled')
    FakeWorker.instances[0].reply('<svg/>'); FakeWorker.instances[1].reply('<svg/>')
    expect(await first).toBe('<svg/>'); await second
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled()
    expect(FakeWorker.instances).toHaveLength(2)
  })
  it('terminates a hung computation and admits the next queued render', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker)
    const first = renderChart(request, new AbortController().signal).catch((error: Error) => error.message)
    const second = renderChart(request, new AbortController().signal).catch((error: Error) => error.message)
    const third = renderChart(request, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await first).toContain('8 second')
    expect(await second).toContain('8 second')
    expect(FakeWorker.instances).toHaveLength(3)
    FakeWorker.instances[2].reply('<svg/>')
    expect(await third).toBe('<svg/>')
    expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBeTruthy()
  })
  it('cancels running workers and rejects worker errors visibly', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const pending = renderChart(request, controller.signal).catch((error: Error) => error.message)
    controller.abort()
    expect(await pending).toBe('Cancelled')
    const failed = renderChart(request, new AbortController().signal).catch((error: Error) => error.message)
    FakeWorker.instances[1].onerror?.()
    expect(await failed).toContain('failed')
    expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBeTruthy()
  })
})
