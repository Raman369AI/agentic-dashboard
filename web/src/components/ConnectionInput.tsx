import type { ConnectionRecord } from '../connection-types'

export function hasStructuredInput(connection: ConnectionRecord) {
  return connection.discovery.adapter?.capabilities.includes('structuredInput') || !!connection.discovery.tools?.length || ['http', 'mcp', 'openapi'].includes(connection.kind)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// Render common schemas; retain the lossless JSON editor for unions, arrays and extensions.
function SchemaFields({ schema, value, onChange, depth = 0 }: {
  schema: Record<string, unknown>; value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void; depth?: number
}) {
  const properties = isObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  if (depth > 8) return <small>Edit deeper fields in the JSON input.</small>
  return <>{Object.entries(properties).slice(0, 100).map(([name, raw]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(name) || !isObject(raw)) return null
    const label = String(raw.title || name) + (required.includes(name) ? ' *' : '')
    const current = value[name]
    const change = (next: unknown) => onChange({ ...value, [name]: next })
    if (raw.type === 'object' || raw.properties) return <fieldset key={name}><legend>{label}</legend><SchemaFields schema={raw} value={isObject(current) ? current : {}} onChange={change} depth={depth + 1} /></fieldset>
    return <label key={name}>{label}
      {Array.isArray(raw.enum) ? <select value={current === undefined ? '' : String(raw.enum.findIndex((option) => JSON.stringify(option) === JSON.stringify(current)))} onChange={(event) => change(event.target.value === '' ? undefined : (raw.enum as unknown[])[Number(event.target.value)])}><option value="">Choose…</option>{raw.enum.map((option, index) => <option key={index} value={index}>{typeof option === 'string' ? option : JSON.stringify(option)}</option>)}</select>
        : raw.type === 'boolean' ? <select value={current === undefined ? '' : String(current)} onChange={(event) => change(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Not set</option><option value="true">True</option><option value="false">False</option></select>
        : ['integer', 'number'].includes(String(raw.type)) ? <input type="number" step={raw.type === 'integer' ? 1 : 'any'} value={typeof current === 'number' ? current : ''} onChange={(event) => change(event.target.value === '' ? undefined : Number(event.target.value))} />
        : raw.type === 'string' ? <input value={typeof current === 'string' ? current : ''} onChange={(event) => change(event.target.value)} />
        : <small>Edit this field in the JSON input below.</small>}
      {typeof raw.description === 'string' && <small>{raw.description}</small>}
    </label>
  })}</>
}

export function ConnectionInput({ connection, tool, onTool, input, onInput, confirmed, onConfirmed }: {
  connection: ConnectionRecord; tool: string; onTool: (value: string) => void
  input: string; onInput: (value: string) => void; confirmed: boolean; onConfirmed: (value: boolean) => void
}) {
  const tools = connection.discovery.tools || []
  const selected = tools.find((entry) => entry.name === tool)
  if (!hasStructuredInput(connection)) return null
  const schema = selected?.inputSchema || connection.http?.input_schema || {}
  let values: Record<string, unknown> = {}
  try { const parsed: unknown = JSON.parse(input); if (isObject(parsed)) values = parsed } catch { /* raw editor shows invalid input */ }
  const operationLabel = connection.kind === 'mcp' ? 'Tool' : 'Operation'
  return <section className="connection-input">
    {tools.length > 0 && <label>{operationLabel}<select aria-label={operationLabel} value={tool} onChange={(event) => { onTool(event.target.value); onInput('{}') }}><option value="">Select an operation</option>{tools.map((entry, index) => <option value={entry.name} key={entry.name + index} disabled={entry.available === false}>{entry.name}{entry.available === false ? ' (unavailable)' : ''}</option>)}</select></label>}
    {selected?.description && <p>{selected.description}</p>}
    <SchemaFields schema={schema} value={values} onChange={(next) => onInput(JSON.stringify(next, null, 2))} />
    <label>{connection.kind === 'mcp' ? 'Tool arguments (JSON)' : 'Query input (JSON)'}<textarea rows={3} value={input} onChange={(event) => onInput(event.target.value)} /></label>
    {selected?.requiresConfirmation && <label><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} />Confirm {selected.method || ''} operation: this request may change service data.</label>}
    {selected && <details><summary>Input schema</summary><pre>{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>}
    {tools.some((entry) => entry.available === false) && <details><summary>Unavailable operations</summary>{tools.filter((entry) => entry.available === false).map((entry, index) => <p key={index}><strong>{entry.name}</strong>: {entry.reason}</p>)}</details>}
    <small>{connection.kind === 'http' ? 'This object fills $input in the connection request mapping.' : 'Inputs are sent to the selected operation. Complex schemas remain editable as JSON.'}</small>
  </section>
}
