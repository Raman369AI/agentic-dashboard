import { useMemo, useRef, useState } from 'react'
import { Activity, AppWindow, ArrowUp, Bot, Boxes, Check, ChevronDown, CircleStop, Command, FileText, LayoutDashboard, Menu, MessageSquare, Moon, Paperclip, PanelRightClose, PanelRightOpen, Plus, Search, Settings2, Sparkles, Users, Workflow } from 'lucide-react'
import { streamAgent } from './api'
import { A2UIRenderer, demoSurface } from './components/A2UIRenderer'
import { AgentDrawer } from './components/AgentDrawer'
import type { A2UISurface, Activity as ActivityItem, ChatMessage, ProtocolEvent } from './types'

const starters = [
  'Show me a live operations dashboard',
  'List the agents I can delegate to',
  'Create a project intake form',
]

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome', role: 'assistant', content: 'Welcome to your agentic workspace. I can coordinate specialists, answer in text, or build an interactive dashboard alongside our conversation.',
  }])
  const [surface, setSurface] = useState<A2UISurface>(demoSurface)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [canvasOpen, setCanvasOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const toolArgs = useRef(new Map<string, { name: string; args: string }>())
  const threadId = useMemo(() => crypto.randomUUID(), [])

  const handleEvent = (event: ProtocolEvent) => {
    const type = String(event.type || '')
    const messageId = String(event.messageId || event.message_id || 'assistant-live')
    if (type === 'TEXT_MESSAGE_START') {
      setMessages((items) => [...items.filter((item) => item.id !== messageId), { id: messageId, role: 'assistant', content: '', pending: true }])
    }
    if (type === 'TEXT_MESSAGE_CONTENT') {
      const delta = String(event.delta || '')
      setMessages((items) => items.map((item) => item.id === messageId ? { ...item, content: item.content + delta } : item))
    }
    if (type === 'TEXT_MESSAGE_END') setMessages((items) => items.map((item) => item.id === messageId ? { ...item, pending: false } : item))
    if (type === 'TOOL_CALL_START') {
      const id = String(event.toolCallId || event.tool_call_id)
      const name = String(event.toolCallName || event.tool_call_name || 'Tool')
      toolArgs.current.set(id, { name, args: '' })
      setActivities((items) => [...items, { id, name: name.replaceAll('_', ' '), status: 'running' }])
    }
    if (type === 'TOOL_CALL_ARGS') {
      const id = String(event.toolCallId || event.tool_call_id)
      const current = toolArgs.current.get(id)
      if (current) current.args += String(event.delta || '')
    }
    if (type === 'TOOL_CALL_END') {
      const id = String(event.toolCallId || event.tool_call_id)
      const current = toolArgs.current.get(id)
      setActivities((items) => items.map((item) => item.id === id ? { ...item, status: 'complete' } : item))
      if (current?.name === 'render_a2ui') {
        try {
          const parsed = JSON.parse(current.args) as { surfaceId?: string; components?: unknown; data?: Record<string, unknown> }
          const components = typeof parsed.components === 'string' ? JSON.parse(parsed.components) : parsed.components
          if (Array.isArray(components)) { setSurface({ surfaceId: parsed.surfaceId || 'generated', components, data: parsed.data }); setCanvasOpen(true) }
        } catch { /* The recovery tool will retry malformed surfaces. */ }
      }
    }
    if (type === 'RUN_ERROR') {
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `I couldn't complete that run: ${String(event.message || 'Unknown error')}` }])
    }
  }

  const send = async (text = input) => {
    const clean = text.trim()
    if (!clean || running) return
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: clean }
    const next = [...messages, user]
    setMessages(next); setInput(''); setActivities([]); setRunning(true)
    controller.current = new AbortController()
    try {
      await streamAgent(threadId, next.filter((item) => item.id !== 'welcome').map(({ id, role, content }) => ({ id, role, content })), controller.current.signal, handleEvent)
    } catch (reason) {
      if (!controller.current.signal.aborted) setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: reason instanceof Error ? reason.message : 'The agent connection failed.' }])
    } finally { setRunning(false) }
  }

  const stop = () => { controller.current?.abort(); setRunning(false) }

  return <div className="app-shell">
    <nav className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Command size={18} /></div><span>Relay</span><small>ADK</small></div>
      <button className="new-thread"><Plus size={17} /> New thread <kbd>⌘ K</kbd></button>
      <div className="nav-group"><span>Workspace</span><button className="active"><MessageSquare size={18} /> Chat</button><button><LayoutDashboard size={18} /> Dashboards</button><button><Workflow size={18} /> Runs <b>3</b></button><button><FileText size={18} /> Artifacts</button></div>
      <div className="nav-group"><span>Manage</span><button onClick={() => setDrawerOpen(true)}><Users size={18} /> Agents</button><button><Boxes size={18} /> Tools</button><button><Activity size={18} /> Activity</button></div>
      <div className="recent"><span>Recent</span><button><i className="dot violet" /> Weekly operations</button><button><i className="dot green" /> Research synthesis</button><button><i className="dot amber" /> Launch readiness</button></div>
      <div className="sidebar-bottom"><button><Settings2 size={18} /> Settings</button><div className="profile"><div>RR</div><span><strong>Workspace</strong><small>Local prototype</small></span><ChevronDown size={15} /></div></div>
    </nav>

    <main>
      <header><button className="icon-button menu-button" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div><span className="eyebrow">Agentic workspace</span><h1>General</h1></div><div className="header-actions"><button className="search"><Search size={17} /> Search <kbd>⌘ /</kbd></button><button className="icon-button"><Moon size={18} /></button><button className="agents-button" onClick={() => setDrawerOpen(true)}><span className="status-dot" /> 1 agent <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setCanvasOpen(!canvasOpen)}>{canvasOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>

      <div className={`workspace ${canvasOpen ? '' : 'canvas-collapsed'}`}>
        <section className="chat-panel">
          <div className="messages">
            <div className="day-label"><span>Today</span></div>
            {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
              {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={16} /></div>}
              <div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Relay' : 'You'}</strong><span>now</span>{message.role === 'assistant' && <em>ADK</em>}</div><p>{message.content || (message.pending ? 'Thinking…' : '')}</p></div>
            </article>)}
            {activities.length > 0 && <div className="activity-stack">{activities.map((item) => <div key={item.id}><span className={item.status}>{item.status === 'complete' ? <Check size={12} /> : <i />}</span><p><strong>{item.status === 'complete' ? 'Completed' : 'Running'}:</strong> {item.name}</p></div>)}</div>}
            {messages.length === 1 && <div className="starters">{starters.map((starter) => <button key={starter} onClick={() => void send(starter)}>{starter}<ArrowUp size={14} /></button>)}</div>}
          </div>
          <div className="composer-wrap"><div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="Ask anything, or describe a dashboard…" rows={1} /><div className="composer-actions"><div><button className="icon-button"><Paperclip size={18} /></button><button className="model-pill"><Bot size={15} /> Gemini 3 Flash <ChevronDown size={13} /></button></div>{running ? <button className="send-button stop" onClick={stop}><CircleStop size={17} /></button> : <button className="send-button" disabled={!input.trim()} onClick={() => void send()}><ArrowUp size={18} /></button>}</div></div><small>Relay may make mistakes. Review important actions.</small></div>
        </section>

        {canvasOpen && <section className="canvas-panel"><div className="canvas-head"><div><AppWindow size={16} /><span>Canvas</span><i>Live</i></div><div><button>Preview</button><button>•••</button></div></div><div className="canvas-title"><div><span className="eyebrow">Generated view</span><h2>Workspace overview</h2><p>Live operational context from your agent network.</p></div><span className="updated"><i /> Synced now</span></div><A2UIRenderer surface={surface} /><div className="canvas-foot"><span><ShieldIcon /> Safe A2UI renderer</span><span>v0.9</span></div></section>}
      </div>
    </main>
    <AgentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    {drawerOpen && <button className="scrim" onClick={() => setDrawerOpen(false)} aria-label="Close drawer" />}
  </div>
}

function ShieldIcon() { return <span className="shield">✓</span> }

export default App
