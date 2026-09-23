// Untrusted expressions run in a terminable worker, never on the rendering thread.
export function testRegex(pattern: string, value: string): Promise<{ valid: boolean; message?: string; severity?: string }> {
  if (pattern.length > 4096 || value.length > 50000) return Promise.reject(new Error('Regex input exceeds safety limits.'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./regex-worker.ts', import.meta.url), { type: 'module' })
    const finish = () => { clearTimeout(timer); worker.terminate() }
    const timer = setTimeout(() => { finish(); reject(new Error('Regular expression timed out.')) }, 200)
    worker.onmessage = ({ data }) => {
      finish()
      if (data.error) reject(new Error(data.error))
      else resolve({ valid: data.valid, ...(data.valid ? {} : { message: 'The value does not match the required pattern.', severity: 'error' }) })
    }
    worker.onerror = () => { finish(); reject(new Error('Regular expression worker failed.')) }
    worker.postMessage({ pattern, value })
  })
}
