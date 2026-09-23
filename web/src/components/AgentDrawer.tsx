import { useCallback, useEffect, useState } from 'react'
import { Bot, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { deleteConnection, discoverConnection, getAdapters, getConnections, saveConnection } from '../connections-api'
import type { AdapterDescriptor, ConnectionKind, ConnectionRecord, ConnectionSpec } from '../connection-types'


export function AgentDrawer({ onClose, onUseAgent, onChanged }: {
  onClose: () => void
  onUseAgent: (agent: ConnectionRecord) => void
  onChanged: (count: number) => void
}) {
  const [agents, setAgents] = useState<ConnectionRecord[]>([])
  const [adapters, setAdapters] = useState<AdapterDescriptor[]>([])
  const [config, setConfig] = useState('{}')
  const [kind, setKind] = useState<ConnectionKind>('a2a')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [a2uiTool, setA2uiTool] = useState('')
  const [authEnv, setAuthEnv] = useState('')
  const [authHeader, setAuthHeader] = useState('Authorization')
  const [authPrefix, setAuthPrefix] = useState('Bearer ')
  const [method, setMethod] = useState<'GET' | 'POST'>('POST')
  const [body, setBody] = useState('{"prompt":"$prompt","input":"$input"}')
  const [responsePath, setResponsePath] = useState('')
  const [manifest, setManifest] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const items = await getConnections()
    setAgents(items); onChanged(items.length)
  }, [onChanged])
  useEffect(() => { let active = true; void getConnections().then((items) => { if (active) { setAgents(items); onChanged(items.length) } }).catch((reason: Error) => { if (active) setError(reason.message) }); return () => { active = false } }, [onChanged])

  useEffect(() => { let active = true; void getAdapters().then((items) => { if (active) setAdapters(items) }).catch((reason: Error) => { if (active) setError(reason.message) }); return () => { active = false } }, [])
  const descriptor = adapters.find((adapter) => adapter.kind === kind)

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Connection failed.') }
    finally { setBusy(false) }
  }

  const connect = () => perform(async () => {
    const spec: ConnectionSpec = manifest.trim() ? JSON.parse(manifest) : {
      kind, name: name.trim(), url: descriptor?.requiresEndpoint === false ? '' : url.trim(), config: JSON.parse(config),
      ...(kind === 'mcp' && a2uiTool ? { a2ui_tool: a2uiTool } : {}),
      ...(authEnv ? { auth: { env: authEnv.trim(), header: authHeader, prefix: authPrefix } } : {}),
      ...(kind === 'http' ? { http: { method, body: JSON.parse(body), response_path: responsePath } } : {}),
    }
    await saveConnection(spec)
    setUrl(''); setName(''); setManifest(''); await refresh()
  })

  return <aside className="drawer open" role="dialog" aria-modal="true" aria-label="Connections">
    <div className="drawer-head"><div><span className="eyebrow">Agents and data services</span><h2>Connections</h2></div><button className="icon-button" onClick={onClose} aria-label="Close connections"><X size={18} /></button></div>
    <p className="muted">Connect an agent or semantic service by its API contract. Direct connections run without a Gemini key.</p>
    <form className="connection-form" onSubmit={(event) => { event.preventDefault(); void connect() }}>
      <label>Connection type<select value={kind} onChange={(event) => { setKind(event.target.value); setConfig('{}') }}>{adapters.map((adapter) => <option key={adapter.kind} value={adapter.kind}>{adapter.label}</option>)}</select></label>
      <label>Name<input required={!manifest.trim()} value={name} onChange={(event) => setName(event.target.value)} placeholder="Sales analytics" /></label>
      {descriptor?.requiresEndpoint !== false && <label>{kind === 'a2a' ? 'Agent base URL' : kind === 'openapi' ? 'OpenAPI document URL' : 'Endpoint URL'}<input type="url" required={!manifest.trim()} value={url} onChange={(event) => setUrl(event.target.value)} placeholder={kind === 'mcp' ? 'https://service.example.com/mcp' : 'https://service.example.com/query'} /></label>}
      {kind === 'mcp' && <label>A2UI return-channel tool (optional)<input value={a2uiTool} onChange={(event) => setA2uiTool(event.target.value)} placeholder="handle_a2ui" /></label>}
      {kind === 'http' && <>
        <label>HTTP method<select value={method} onChange={(event) => setMethod(event.target.value as 'GET' | 'POST')}><option>POST</option><option>GET</option></select></label>
        <label>Request mapping (JSON)<textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <small>Use $prompt, $input, $messages, $threadId, $a2uiMessages, or $metadata as complete JSON values. GET uses query parameters.</small>
        <label>Response JSON pointer<input value={responsePath} onChange={(event) => setResponsePath(event.target.value)} placeholder="/data/rows (blank keeps the full response)" /></label>
      </>}
      {descriptor && (Object.keys((descriptor.configSchema.properties || {}) as object).length > 0 || descriptor.configSchema.additionalProperties !== false) && <details><summary>Adapter configuration</summary><label>Adapter configuration (JSON)<textarea rows={4} value={config} onChange={(event) => setConfig(event.target.value)} /></label><pre>{JSON.stringify(descriptor.configSchema, null, 2)}</pre></details>}
      <details><summary>Authentication</summary><label>API environment variable<input value={authEnv} onChange={(event) => setAuthEnv(event.target.value)} placeholder="SALES_API_TOKEN" /></label><label>Header<input value={authHeader} onChange={(event) => setAuthHeader(event.target.value)} /></label><label>Prefix<input value={authPrefix} onChange={(event) => setAuthPrefix(event.target.value)} /></label><small>Enter the variable name, not the secret. The API resolves it at run time.</small></details>
      <details><summary>Import connection manifest</summary><label>Manifest JSON<textarea rows={6} value={manifest} onChange={(event) => setManifest(event.target.value)} placeholder='{"name":"Sales","kind":"http","url":"https://..."}' /></label></details>
      <button className="primary-action" disabled={busy || adapters.length === 0} type="submit"><Plus size={16} /> {busy ? 'Connecting…' : 'Add connection'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="agent-list">
      {agents.length === 0 && <div className="empty-agents"><Bot size={26} /><strong>No connections yet</strong><span>Add an agent endpoint, HTTP API, or MCP server.</span></div>}
      {agents.map((agent) => <article className="agent-row" key={agent.id}><div className="agent-avatar"><Bot size={18} /></div><div><strong>{agent.name}</strong><span>{agent.url}</span><small>{agent.discovery.adapter?.label || adapters.find((item) => item.kind === agent.kind)?.label || agent.kind} · {agent.discovery.verified ? 'Discovered' : 'Configured; run to verify'}</small></div>
        <button className="use-agent" disabled={busy} onClick={() => { onUseAgent(agent); onClose() }}>Use</button>
        <button className="icon-button" disabled={busy} aria-label={`Refresh ${agent.name}`} onClick={() => void perform(async () => { const discovery = await discoverConnection(agent.id); setAgents((items) => items.map((item) => item.id === agent.id ? { ...item, discovery } : item)) })}><RefreshCw size={16} /></button>
        <button className="icon-button danger" disabled={busy} onClick={() => void perform(async () => { await deleteConnection(agent.id); await refresh() })} aria-label={`Remove ${agent.name}`}><Trash2 size={16} /></button>
      </article>)}
    </div>
  </aside>
}
