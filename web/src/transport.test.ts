import { expect, test } from 'vitest'
import { consumeEvents } from './transport'

test('parses chunked UTF-8, CRLF, multiline SSE and unterminated final events', async () => {
  const data = ': ping\r\ndata: {"type":"CUSTOM",\r\ndata: "value":"caf\u00e9"}\r\n\r\ndata: {"type":"RUN_FINISHED"}'
  const bytes = new TextEncoder().encode(data)
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } })
  const events: unknown[] = []
  await consumeEvents(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), (event) => events.push(event))
  expect(events).toEqual([{ type: 'CUSTOM', value: 'caf\u00e9' }, { type: 'RUN_FINISHED' }])
})

test('does not silently discard malformed JSON', async () => {
  await expect(consumeEvents(new Response('data: broken\n\n', { headers: { 'content-type': 'text/event-stream' } }), () => undefined)).rejects.toThrow()
})
