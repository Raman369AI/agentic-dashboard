import { useEffect, useRef, useState } from 'react'
import { Activity, AppWindow, ArrowUp, Bot, Boxes, Check, ChevronDown, CircleStop, Command, Download, FileText, LayoutDashboard, Menu, MessageSquare, Moon, MoreHorizontal, Paperclip, PanelRightClose, PanelRightOpen, Plus, Search, Settings2, Sparkles, Sun, Users, Workflow, X } from 'lucide-react'
import { getAgents, invokeRemoteAgent, streamAgent } from './api'
import { A2UIRenderer, demoSurface } from './components/A2UIRenderer'
import { AgentDrawer } from './components/AgentDrawer'
import { ResultRenderer } from './components/ResultRenderer'
import { normalizeResult, surfaceFromToolArgs } from './protocol'
import type { A2UISurface, Activity as ActivityItem, AgentRecord, ChatMessage, ProtocolEvent, ResultBlock, WorkspaceView } from './types'

const starters = ['Show me a live operations dashboard', 'List the agents I can delegate to', 'Create a project intake form']
const nav = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'dashboards', label: 'Dashboards', icon: LayoutDashboard },
  { id: 'runs', label: 'Runs', icon: Workflow },
  { id: 'artifacts', label: 'Artifacts', icon: FileText },
] as const
const manage = [
  { id: 'tools', label: 'Tools', icon: Boxes },
  { id: 'activity', label: 'Activity', icon: Activity },
] as const
const welcome: ChatMessage = { id: 'welcome', role: 'assistant', content: 'Welcome to your agentic workspace. Connect any A2A agent, chat with the ADK coordinator, or render structured results beside the conversation.' }

function App() {
  const [view, setView] = useState<WorkspaceView>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([welcome])
  const [results, setResults] = useState<ResultBlock[]>([{ id: 'demo', kind: 'a2ui', surface: demoSurface, title: 'Workspace overview', source: 'Relay' }])
  const [surface, setSurface] = useState<A2UISurface>(demoSurface)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [events, setEvents] = useState<ProtocolEvent[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [canvasOpen, setCanvasOpen] = useState(true)
  const [canvasFull, setCanvasFull] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [canvasMenu, setCanvasMenu] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('relay-theme') === 'light' ? 'light' : 'dark')
  const [threadId, setThreadId] = useState(() => crypto.randomUUID())
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const toolArgs = useRef(new Map<string, { name: string; args: string }>())

  useEffect(() => { void getAgents().then((items) => setAgentCount(items.length)).catch(() => undefined) }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newThread() }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') { event.preventDefault(); setSearchOpen(true) }
      if (event.key === 'Escape') { setSearchOpen(false); setModelOpen(false); setCanvasMenu(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const addResults = (blocks: ResultBlock[]) => {
    if (!blocks.length) return
    setResults((items) => [...items, ...blocks])
    const lastSurface = [...blocks].reverse().find((block) => block.surface)?.surface
    if (lastSurface) { setSurface(lastSurface); setCanvasOpen(true) }
  }

  const newThread = () => {
    controller.current?.abort()
    setThreadId(crypto.randomUUID()); setMessages([welcome]); setActivities([]); setEvents([])
    setResults([{ id: crypto.randomUUID(), kind: 'a2ui', surface: demoSurface, title: 'Workspace overview', source: 'Relay' }])
    setSurface(demoSurface); setSelectedAgent(null); setInput(''); setView('chat'); setRunning(false)
  }

  const handleEvent = (event: ProtocolEvent) => {
    setEvents((items) => [...items.slice(-199), event])
    const type = String(event.type || '')
    const messageId = String(event.messageId || event.message_id || 'assistant-live')
    if (type === 'TEXT_MESSAGE_START' || type === 'TEXT_MESSAGE_CHUNK') {
      setMessages((items) => items.some((item) => item.id === messageId) ? items : [...items, { id: messageId, role: 'assistant', content: '', pending: true }])
    }
    if (['TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CHUNK'].includes(type) && event.delta) {
      const delta = String(event.delta)
      setMessages((items) => items.map((item) => item.id === messageId ? { ...item, content: item.content + delta } : item))
    }
    if (type === 'TEXT_MESSAGE_END') setMessages((items) => items.map((item) => item.id === messageId ? { ...item, pending: false } : item))
    if (type === 'TOOL_CALL_START') {
      const id = String(event.toolCallId || event.tool_call_id)
      const name = String(event.toolCallName || event.tool_call_name || 'Tool')
      toolArgs.current.set(id, { name, args: '' })
      setActivities((items) => [...items, { id, name: name.replaceAll('_', ' '), status: 'running', startedAt: new Date().toISOString() }])
    }
    if (type === 'TOOL_CALL_ARGS') {
      const current = toolArgs.current.get(String(event.toolCallId || event.tool_call_id))
      if (current) current.args += String(event.delta || '')
    }
    if (type === 'TOOL_CALL_END') {
      const id = String(event.toolCallId || event.tool_call_id)
      const current = toolArgs.current.get(id)
      setActivities((items) => items.map((item) => item.id === id ? { ...item, status: 'complete', endedAt: new Date().toISOString() } : item))
      if (current?.name === 'render_a2ui') {
        const nextSurface = surfaceFromToolArgs(current.args)
        if (nextSurface) addResults([{ id: crypto.randomUUID(), kind: 'a2ui', surface: nextSurface, title: nextSurface.surfaceId, source: 'A2UI' }])
      }
    }
    if (type === 'TOOL_CALL_RESULT') addResults(normalizeResult(event.content ?? event.result, 'Tool result'))
    if (['CUSTOM', 'RAW'].includes(type)) addResults(normalizeResult(event.value ?? event.data ?? event.event, type))
    if (type === 'ACTIVITY_SNAPSHOT') setActivities((items) => [...items, { id: crypto.randomUUID(), name: String(event.activityType || 'Agent activity'), detail: JSON.stringify(event.content || {}), status: 'running', startedAt: new Date().toISOString() }])
    if (type === 'SUBAGENT_STARTED') setActivities((items) => [...items, { id: String(event.runId || crypto.randomUUID()), name: String(event.agentName || 'Sub-agent'), status: 'running', startedAt: new Date().toISOString() }])
    if (type === 'SUBAGENT_FINISHED' || type === 'SUBAGENT_ERROR') setActivities((items) => items.map((item) => item.id === String(event.runId) ? { ...item, status: type === 'SUBAGENT_ERROR' ? 'error' : 'complete', endedAt: new Date().toISOString() } : item))
    if (type === 'RUN_ERROR') {
      const text = String(event.message || 'Unknown error')
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `I couldn't complete that run: ${text}` }])
      addResults([{ id: crypto.randomUUID(), kind: 'error', text, source: 'AG-UI' }])
    }
  }

  const send = async (text = input) => {
    const clean = text.trim()
    if (!clean || running) return
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: clean }
    const next = [...messages, user]
    setMessages(next); setInput(''); setActivities([]); setRunning(true); setView('chat')
    controller.current = new AbortController()
    try {
      if (selectedAgent) {
        const runId = crypto.randomUUID()
        setActivities([{ id: runId, name: selectedAgent.name, status: 'running', startedAt: new Date().toISOString() }])
        const remoteEvents = await invokeRemoteAgent(selectedAgent.id, clean, controller.current.signal)
        const blocks = remoteEvents.flatMap((event) => normalizeResult(event, selectedAgent.name))
        const text = blocks.filter((block) => block.kind === 'text').map((block) => block.text).filter(Boolean).join('\n\n')
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: text || `${selectedAgent.name} returned ${blocks.length} structured result${blocks.length === 1 ? '' : 's'}.` }])
        addResults(blocks)
        setActivities((items) => items.map((item) => item.id === runId ? { ...item, status: 'complete', endedAt: new Date().toISOString() } : item))
      } else {
        await streamAgent(threadId, next.filter((item) => item.id !== 'welcome').map(({ id, role, content }) => ({ id, role, content })), controller.current.signal, handleEvent)
      }
    } catch (reason) {
      if (!controller.current.signal.aborted) {
        const text = reason instanceof Error ? reason.message : 'The agent connection failed.'
        setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: text }])
        addResults([{ id: crypto.randomUUID(), kind: 'error', text, source: selectedAgent?.name || 'Relay' }])
        setActivities((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'error', endedAt: new Date().toISOString() } : item))
      }
    } finally { setRunning(false) }
  }

  const stop = () => { controller.current?.abort(); setRunning(false) }
  const chooseView = (next: WorkspaceView) => { setView(next); setMobileNav(false) }
  const selectAgent = (agent: AgentRecord) => { setSelectedAgent(agent); setInput(`Ask ${agent.name}: `); setView('chat') }
  const loadRecent = (title: string) => { newThread(); setMessages([welcome, { id: crypto.randomUUID(), role: 'user', content: title }, { id: crypto.randomUUID(), role: 'assistant', content: 'This local prototype starts new history for saved threads. Send a message to continue this workspace.' }]); setInput(title) }
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); localStorage.setItem('relay-theme', next) }
  const attach = (file?: File) => {
    if (!file) return
    const kind: ResultBlock['kind'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file'
    addResults([{ id: crypto.randomUUID(), kind, name: file.name, title: file.name, mimeType: file.type, url: URL.createObjectURL(file), source: 'You' }])
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: `Attached ${file.name}` }]); setCanvasOpen(true)
  }
  const exportCanvas = () => {
    const blob = new Blob([JSON.stringify(surface, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${surface.surfaceId}.json`; anchor.click(); URL.revokeObjectURL(url); setCanvasMenu(false)
  }
  const handleSurfaceAction = (name: string, context: unknown, data: Record<string, unknown>) => void send(`UI action: ${name}\nContext: ${JSON.stringify(context || {})}\nForm data: ${JSON.stringify(data)}`)

  const searched = search.trim().toLowerCase()
  const searchItems = searched ? [
    ...messages.filter((item) => item.content.toLowerCase().includes(searched)).map((item) => ({ label: item.content, action: () => { setView('chat'); setSearchOpen(false) } })),
    ...results.filter((item) => `${item.title || ''} ${item.name || ''} ${item.text || ''}`.toLowerCase().includes(searched)).map((item) => ({ label: item.title || item.name || item.kind, action: () => { if (item.surface) setSurface(item.surface); setView('dashboards'); setSearchOpen(false) } })),
  ] : []

  return <div className={`app-shell ${theme} ${canvasFull ? 'canvas-full' : ''}`}>
    <nav className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Command size={18} /></div><span>Relay</span><small>ADK</small></div>
      <button className="new-thread" onClick={newThread}><Plus size={17} /> New thread <kbd>⌘ K</kbd></button>
      <div className="nav-group"><span>Workspace</span>{nav.map((item) => <button className={view === item.id ? 'active' : ''} onClick={() => chooseView(item.id)} key={item.id}><item.icon size={18} /> {item.label}{item.id === 'runs' && activities.length > 0 && <b>{activities.length}</b>}</button>)}</div>
      <div className="nav-group"><span>Manage</span><button onClick={() => setDrawerOpen(true)}><Users size={18} /> Agents{agentCount > 0 && <b>{agentCount}</b>}</button>{manage.map((item) => <button className={view === item.id ? 'active' : ''} onClick={() => chooseView(item.id)} key={item.id}><item.icon size={18} /> {item.label}</button>)}</div>
      <div className="recent"><span>Recent</span>{['Weekly operations', 'Research synthesis', 'Launch readiness'].map((label, index) => <button onClick={() => loadRecent(label)} key={label}><i className={`dot ${['violet', 'green', 'amber'][index]}`} /> {label}</button>)}</div>
      <div className="sidebar-bottom"><button className={view === 'settings' ? 'active' : ''} onClick={() => chooseView('settings')}><Settings2 size={18} /> Settings</button><button className="profile" onClick={() => chooseView('settings')}><div>RR</div><span><strong>Workspace</strong><small>{selectedAgent ? selectedAgent.name : 'ADK coordinator'}</small></span><ChevronDown size={15} /></button></div>
    </nav>

    <main>
      <header><button className="icon-button menu-button" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div><span className="eyebrow">Agentic workspace</span><h1>{view[0].toUpperCase() + view.slice(1)}</h1></div><div className="header-actions"><button className="search" onClick={() => setSearchOpen(true)}><Search size={17} /> Search <kbd>⌘ /</kbd></button><button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}</button><button className="agents-button" onClick={() => setDrawerOpen(true)}><span className="status-dot" /> {agentCount + 1} agent{agentCount ? 's' : ''} <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setCanvasOpen(!canvasOpen)}>{canvasOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>

      {view === 'chat' ? <div className={`workspace ${canvasOpen ? '' : 'canvas-collapsed'}`}>
        <section className="chat-panel">
          {selectedAgent && <div className="agent-mode"><Bot size={14} /><span>Direct to <strong>{selectedAgent.name}</strong> over A2A</span><button onClick={() => setSelectedAgent(null)}><X size={13} /> Use coordinator</button></div>}
          <div className="messages"><div className="day-label"><span>Today</span></div>{messages.map((message) => <article className={`message ${message.role}`} key={message.id}>{message.role === 'assistant' && <div className="message-avatar"><Sparkles size={16} /></div>}<div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? selectedAgent?.name || 'Relay' : 'You'}</strong><span>now</span>{message.role === 'assistant' && <em>{selectedAgent ? 'A2A' : 'ADK'}</em>}</div><p>{message.content || (message.pending ? 'Thinking…' : '')}</p></div></article>)}{activities.length > 0 && <div className="activity-stack">{activities.map((item) => <div key={item.id}><span className={item.status}>{item.status === 'complete' ? <Check size={12} /> : <i />}</span><p><strong>{item.status === 'complete' ? 'Completed' : item.status === 'error' ? 'Failed' : 'Running'}:</strong> {item.name}</p></div>)}</div>}{messages.length === 1 && <div className="starters">{starters.map((starter) => <button key={starter} onClick={() => void send(starter)}>{starter}<ArrowUp size={14} /></button>)}</div>}</div>
          <div className="composer-wrap"><div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={selectedAgent ? `Message ${selectedAgent.name}…` : 'Ask anything, or describe a dashboard…'} rows={1} /><div className="composer-actions"><div><button className="icon-button" onClick={() => fileInput.current?.click()} aria-label="Attach file"><Paperclip size={18} /></button><input ref={fileInput} type="file" hidden onChange={(event) => attach(event.target.files?.[0])} /><div className="model-menu-wrap"><button className="model-pill" onClick={() => setModelOpen(!modelOpen)}><Bot size={15} /> {selectedAgent?.name || 'Gemini 3 Flash'} <ChevronDown size={13} /></button>{modelOpen && <div className="model-menu"><button onClick={() => { setSelectedAgent(null); setModelOpen(false) }}><Check size={13} /> Gemini 3 Flash · ADK</button><button onClick={() => { setDrawerOpen(true); setModelOpen(false) }}><Plus size={13} /> Connect A2A agent</button></div>}</div></div>{running ? <button className="send-button stop" onClick={stop}><CircleStop size={17} /></button> : <button className="send-button" disabled={!input.trim()} onClick={() => void send()}><ArrowUp size={18} /></button>}</div></div><small>Relay may make mistakes. Review important actions.</small></div>
        </section>
        {canvasOpen && <section className="canvas-panel"><div className="canvas-head"><div><AppWindow size={16} /><span>Canvas</span><i>Live</i></div><div><button onClick={() => setCanvasFull(!canvasFull)}>{canvasFull ? 'Exit preview' : 'Preview'}</button><div className="canvas-menu-wrap"><button onClick={() => setCanvasMenu(!canvasMenu)} aria-label="Canvas menu"><MoreHorizontal size={16} /></button>{canvasMenu && <div className="canvas-menu"><button onClick={exportCanvas}><Download size={13} /> Export JSON</button><button onClick={() => { setSurface(demoSurface); setResults([]); setCanvasMenu(false) }}>Clear canvas</button></div>}</div></div></div><div className="canvas-title"><div><span className="eyebrow">Dynamic result</span><h2>{surface.surfaceId.replaceAll('-', ' ')}</h2><p>Native, safe rendering from the active agent.</p></div><span className="updated"><i /> Synced now</span></div><A2UIRenderer key={surface.surfaceId + JSON.stringify(surface.data || {})} surface={surface} onAction={handleSurfaceAction} />{results.filter((item) => item.kind !== 'a2ui').slice(-4).map((block) => <div className="canvas-result" key={block.id}><ResultRenderer block={block} /></div>)}<div className="canvas-foot"><span><ShieldIcon /> Dynamic protocol renderer</span><span>AG-UI · A2UI · A2A</span></div></section>}
      </div> : <WorkspacePage view={view} results={results} activities={activities} events={events} surface={surface} onSurface={setSurface} onChat={() => setView('chat')} theme={theme} onTheme={toggleTheme} />}
    </main>

    <AgentDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onUseAgent={selectAgent} onChanged={(agents) => setAgentCount(agents.length)} />
    {drawerOpen && <button className="scrim" onClick={() => setDrawerOpen(false)} aria-label="Close drawer" />}
    {searchOpen && <div className="modal-backdrop" onClick={() => setSearchOpen(false)}><section className="search-modal" onClick={(event) => event.stopPropagation()}><div><Search size={18} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages and results" /><button className="icon-button" onClick={() => setSearchOpen(false)}><X size={16} /></button></div><div className="search-results">{searched && searchItems.length === 0 && <p>No matching workspace content.</p>}{searchItems.map((item, index) => <button onClick={item.action} key={index}>{item.label}</button>)}</div></section></div>}
  </div>
}

function WorkspacePage({ view, results, activities, events, surface, onSurface, onChat, theme, onTheme }: { view: WorkspaceView; results: ResultBlock[]; activities: ActivityItem[]; events: ProtocolEvent[]; surface: A2UISurface; onSurface: (surface: A2UISurface) => void; onChat: () => void; theme: string; onTheme: () => void }) {
  const surfaces = results.filter((item) => item.surface)
  const artifacts = results.filter((item) => ['image', 'audio', 'video', 'file'].includes(item.kind))
  return <div className="page-view"><div className="page-heading"><span className="eyebrow">Workspace</span><h2>{view[0].toUpperCase() + view.slice(1)}</h2><p>Everything produced by local and remote agents is normalized into this workspace.</p></div>
    {view === 'dashboards' && <div className="result-grid">{surfaces.length ? surfaces.map((block) => <article className="result-card" key={block.id}><div><strong>{block.title}</strong><span>{block.source}</span></div><ResultRenderer block={block} onExpand={() => { if (block.surface) onSurface(block.surface); onChat() }} /></article>) : <Empty label="No generated dashboards yet" action={onChat} />}</div>}
    {view === 'runs' && <div className="data-list">{activities.length ? activities.map((item) => <article key={item.id}><span className={`run-state ${item.status}`} /><div><strong>{item.name}</strong><small>{item.detail || 'Agent execution'}</small></div><em>{item.status}</em></article>) : <Empty label="No runs in this thread" action={onChat} />}</div>}
    {view === 'artifacts' && <div className="artifact-grid">{artifacts.length ? artifacts.map((block) => <ResultRenderer block={block} key={block.id} />) : <Empty label="Files and media returned by agents appear here" action={onChat} />}</div>}
    {view === 'tools' && <div className="settings-grid"><section><h3>Protocol adapters</h3><p>Relay accepts AG-UI events, A2UI surfaces, and A2A text, data, file, artifact, task, and status parts.</p><div className="chip-row"><span>Text</span><span>JSON</span><span>Tables</span><span>Images</span><span>Audio</span><span>Video</span><span>Files</span><span>A2UI</span></div></section><section><h3>Unknown output</h3><p>Unrecognized structured results are displayed as an expandable JSON inspector instead of being discarded.</p></section></div>}
    {view === 'activity' && <div className="event-log">{events.length ? [...events].reverse().map((event, index) => <details key={index}><summary><span>{String(event.type || 'EVENT')}</span><small>{new Date().toLocaleTimeString()}</small></summary><pre>{JSON.stringify(event, null, 2)}</pre></details>) : <Empty label="Protocol events appear here while agents run" action={onChat} />}</div>}
    {view === 'settings' && <div className="settings-grid"><section><h3>Appearance</h3><p>Current theme: {theme}</p><button className="primary-action" onClick={onTheme}>{theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</button></section><section><h3>Renderer policy</h3><p>Generated content stays declarative. Unknown components fall back to an inspectable payload and arbitrary code is never executed.</p></section><section><h3>Active canvas</h3><p>{surface.surfaceId} · {surface.components.length} components</p></section></div>}
  </div>
}

function Empty({ label, action }: { label: string; action: () => void }) { return <div className="page-empty"><AppWindow size={26} /><strong>{label}</strong><button onClick={action}>Open chat</button></div> }
function ShieldIcon() { return <span className="shield">✓</span> }
export default App
