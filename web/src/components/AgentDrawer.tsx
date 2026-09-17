import { useCallback, useEffect, useState } from 'react'
import { Bot, Link2, MessageSquare, Plus, Trash2, X } from 'lucide-react'
import { getAgents, registerAgent, removeAgent } from '../api'
import type { AgentRecord } from '../types'

export function AgentDrawer({ open, onClose, onUseAgent, onChanged }: { open: boolean; onClose: () => void; onUseAgent: (agent: AgentRecord) => void; onChanged?: (agents: AgentRecord[]) => void }) {
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => getAgents().then((items) => { setAgents(items); onChanged?.(items) }).catch(() => setAgents([])), [onChanged])
  useEffect(() => { if (open) void refresh() }, [open, refresh])

  const connect = async () => {
    setBusy(true); setError('')
    try { await registerAgent(url); setUrl(''); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Connection failed.') }
    finally { setBusy(false) }
  }

  return <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><span className="eyebrow">A2A registry</span><h2>Connected agents</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
    <p className="muted">Add any standards-compatible agent using its public Agent Card endpoint.</p>
    <div className="connect-box"><Link2 size={17} /><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void connect() }} placeholder="https://agent.example.com" /><button disabled={busy || !url} onClick={() => void connect()}><Plus size={16} /> {busy ? 'Checking…' : 'Connect'}</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="agent-list">
      {agents.length === 0 && <div className="empty-agents"><Bot size={26} /><strong>No remote agents yet</strong><span>The coordinator remains available.</span></div>}
      {agents.map((agent) => <article className="agent-row" key={agent.id}><div className="agent-avatar"><Bot size={18} /></div><div><strong>{agent.name}</strong><span>{agent.description || agent.baseUrl}</span><small><i /> {agent.status} · A2A</small></div><button className="use-agent" onClick={() => { onUseAgent(agent); onClose() }}><MessageSquare size={14} /> Use</button><button className="icon-button danger" onClick={() => void removeAgent(agent.id).then(refresh)} aria-label={`Remove ${agent.name}`}><Trash2 size={16} /></button></article>)}
    </div>
  </aside>
}
