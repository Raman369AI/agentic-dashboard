import { assertSafeData, record, type JsonMap } from './schema'

export function absolutePath(path: string, scope = '') { return path.startsWith('/') ? path : scope.replace(/\/$/, '') + '/' + path }
export function pathKeys(path: string) {
  if (!path || path === '/') return []
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) throw new Error('Invalid JSON pointer.')
  const keys = path.slice(1).split('/').map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Unsafe JSON pointer.')
  return keys
}
export function readPath(data: unknown, path: string): unknown {
  return pathKeys(path).reduce<unknown>((value, key) => (record(value) || Array.isArray(value)) && Object.hasOwn(value, key) ? (value as JsonMap)[key] : undefined, data)
}
export function writePath(data: unknown, path: string, value: unknown, removeNull = false): unknown {
  assertSafeData(value)
  const keys = pathKeys(path)
  if (!keys.length) return value === null && removeNull ? {} : structuredClone(value)
  const root = structuredClone(record(data) || Array.isArray(data) ? data : {})
  let cursor = root as JsonMap
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (Array.isArray(cursor) && (!/^(0|[1-9]\\d*)$/.test(key) || Number(key) > cursor.length)) throw new Error('Invalid array index.')
    const object = cursor as JsonMap
    if (!record(object[key]) && !Array.isArray(object[key])) object[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    cursor = object[key]
  }
  const key = keys.at(-1)!
  if (Array.isArray(cursor)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > cursor.length) throw new Error('Invalid array index.')
    if (value === null && removeNull) cursor.splice(Number(key), 1)
    else cursor[Number(key)] = structuredClone(value)
  } else if (value === null && removeNull) delete cursor[key]
  else cursor[key] = structuredClone(value)
  return root
}
