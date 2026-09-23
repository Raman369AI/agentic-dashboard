import { chartSvg } from './chart-runtime'
import type { ChartRequest } from './contract'

self.onmessage = async (event: MessageEvent<ChartRequest>) => {
  try { self.postMessage({ svg: await chartSvg(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Visualization failed.' }) }
}
