self.onmessage = (event: MessageEvent<{ pattern: string; value: string }>) => {
  try { self.postMessage({ valid: new RegExp(event.data.pattern, 'u').test(event.data.value) }) }
  catch { self.postMessage({ error: 'Invalid regular expression.' }) }
}
export {}
