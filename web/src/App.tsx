import { useEffect, useRef, useState } from 'react'
import { Activity, AppWindow, ArrowUp, Bot, Boxes, Check, ChevronDown, CircleStop, Command, Download, FileText, LayoutDashboard, Menu, MessageSquare, Moon, MoreHorizontal, Paperclip, PanelRightClose, PanelRightOpen, Plus, Search, Settings2, Sparkles, Sun, Users, Workflow, X } from 'lucide-react'
import { A2UIContext } from './a2ui/A2UIRenderer'
import { streamAgent } from './api'
import { getConnections, runConnection } from './connections-api'
import type { ConnectionRecord } from './connection-types'
import { ConnectionInput, hasStructuredInput } from './components/ConnectionInput'
import { applyPatch, type Operation } from 'fast-json-patch'
import { emptySurface } from './components/A2UIRenderer'
import { AgentDrawer } from './components/AgentDrawer'
import { Markdown, ResultRenderer } from './components/ResultRenderer'
import { ResultNormalizer, surfaceFromToolArgs } from './protocol'
import type { A2UISurface, Activity as ActivityItem, ChatMessage, ProtocolEvent, ResultBlock, WorkspaceView } from './types'

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
const welcome: ChatMessage = { id: 'welcome', role: 'assistant', content: 'Welcome to your agentic workspace. Connect an agent, an OpenAPI or HTTP service, MCP tools, or an installed adapter. Results appear beside the conversation. The ADK coordinator is optional.' }

function App() {
  const [view, setView] = useState<WorkspaceView>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([welcome])
  const [results, setResults] = useState<ResultBlock[]>([])
  const [surface, setSurface] = useState<A2UISurface>(emptySurface)
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
  const [selectedAgent, setSelectedAgent] = useState<ConnectionRecord | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const [tool, setTool] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [queryInput, setQueryInput] = useState('{}')
  const [normalizer, setNormalizer] = useState(() => new ResultNormalizer())
  const uiControllers = useRef(new Set<AbortController>())
  const agentState = useRef<Record<string, unknown>>({})
  const controller = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const toolArgs = useRef(new Map<string, { name: string; args: string }>())

  useEffect(() => { void getConnections().then((items) => setAgentCount(items.length)).catch(() => undefined) }, [])


  const addResults = (blocks: ResultBlock[]) => {
    if (!blocks.length) return
    setResults((items) => {
      let updated = [...items]
      for (const block of blocks) {
        if (block.kind === 'surface-delete') updated = updated.filter((item) => (item.surface?.surfaceId ?? item.surfaceId) !== block.surfaceId)
        else if (block.kind === 'a2ui-v1') updated = [...updated.filter((item) => item.id !== block.id), block]
        else if (block.surface) updated = [...updated.filter((item) => item.surface?.surfaceId !== block.surface?.surfaceId), block]
        else updated.push(block)
      }
      return updated
    })
    setCanvasOpen(true)
    const lastSurface = [...blocks].reverse().find((block) => block.surface)?.surface
    if (lastSurface) { setSurface(lastSurface); setCanvasOpen(true) }
  }

  const newThread = () => {
    controller.current?.abort()
    for (const active of uiControllers.current) active.abort()
    uiControllers.current.clear()
    setThreadId(crypto.randomUUID()); setMessages([welcome]); setActivities([]); setEvents([])
    setResults([]); normalizer.a2ui.dispose(); setNormalizer(new ResultNormalizer()); agentState.current = {}; toolArgs.current.clear()
    setSurface(emptySurface); setConfirmed(false); setTool(''); setQueryInput('{}'); setSelectedAgent(null); setInput(''); setView('chat'); setRunning(false)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newThread() }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') { event.preventDefault(); setSearchOpen(true) }
      if (event.key === 'Escape') { setSearchOpen(false); setModelOpen(false); setCanvasMenu(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const handleEvent = (event: ProtocolEvent) => {
    normalizer.setOwner(selectedAgent?.id || 'coordinator')
    setEvents((items) => [...items.slice(-199), event])
    const type = String(event.type || '')
    if (type === 'STATE_SNAPSHOT') { agentState.current = (event.snapshot || {}) as Record<string, unknown>; addResults(normalizer.normalize(agentState.current, 'Agent state')) }
    if (type === 'STATE_DELTA') { agentState.current = applyPatch(agentState.current, event.delta as Operation[], true, false).newDocument; addResults(normalizer.normalize(agentState.current, 'Agent state')) }
    if (type === 'MESSAGES_SNAPSHOT' && Array.isArray(event.messages)) {
      setMessages(event.messages.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map((m) => ({ id: m.id, role: m.role, content: m.content })))
    }
    const messageId = String(event.messageId || event.message_id || 'assistant-live')
    if (['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CHUNK', 'TEXT_MESSAGE_CONTENT'].includes(type)) {
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
    if (type === 'TOOL_CALL_RESULT') addResults(normalizer.normalize(event.content ?? event.result, 'Tool result'))
    if (['CUSTOM', 'RAW'].includes(type)) {
      const blocks = normalizer.normalize(event.value ?? event.data ?? event.event, selectedAgent?.name || type)
      addResults(blocks)
      if (event.name === 'relay.result') {
        const text = blocks.filter((block) => ['text', 'markdown'].includes(block.kind)).map((block) => block.text).join('\n\n')
        if (text) setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: text }])
      }
    }
    if (type === 'ACTIVITY_SNAPSHOT') setActivities((items) => [...items, { id: crypto.randomUUID(), name: String(event.activityType || 'Agent activity'), detail: JSON.stringify(event.content || {}), status: 'running', startedAt: new Date().toISOString() }])
    if (type === 'SUBAGENT_STARTED') setActivities((items) => [...items, { id: String(event.runId || crypto.randomUUID()), name: String(event.agentName || 'Sub-agent'), status: 'running', startedAt: new Date().toISOString() }])
    if (type === 'SUBAGENT_FINISHED' || type === 'SUBAGENT_ERROR') setActivities((items) => items.map((item) => item.id === String(event.runId) ? { ...item, status: type === 'SUBAGENT_ERROR' ? 'error' : 'complete', endedAt: new Date().toISOString() } : item))
    if (type === 'RUN_FINISHED') setActivities((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'complete', endedAt: new Date().toISOString() } : item))
    if (type === 'RUN_ERROR') {
      setActivities((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'error', endedAt: new Date().toISOString() } : item))
      const text = String(event.message || 'Unknown error')
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `I couldn't complete that run: ${text}` }])
      addResults([{ id: crypto.randomUUID(), kind: 'error', text, source: 'AG-UI' }])
    }
  }

  useEffect(() => {
    const runtime = normalizer.a2ui
    const controllers = uiControllers.current
    let closed = false
    runtime.setDelivery(async ({ message, metadata, owner }) => {
      if (closed || owner !== (selectedAgent?.id || 'coordinator')) throw new Error('The originating agent session is no longer active.')
      const active = new AbortController()
      uiControllers.current.add(active)
      let failure: string | undefined
      const receive = (event: ProtocolEvent) => {
        if (closed || active.signal.aborted) return
        if (event.type === 'RUN_ERROR') failure = String(event.message || 'UI delivery failed.')
        handleEvent(event)
      }
      try {
        if (selectedAgent) {
          const operation = selectedAgent.kind === 'openapi'
            ? selectedAgent.discovery.tools?.find((entry) => entry.name === selectedAgent.config?.a2ui_operation)
            : undefined
          // A declined write stays local; reporting it through this operation would prompt again.
          if (operation?.requiresConfirmation && message.error?.message === 'OpenAPI operation was not confirmed.') return
          const confirmed = operation?.requiresConfirmation
            ? window.confirm(`Confirm ${operation.method || 'write'} operation ${operation.name}: this request may change service data.`)
            : false
          if (operation?.requiresConfirmation && !confirmed) throw new Error('OpenAPI operation was not confirmed.')
          await runConnection(selectedAgent.id, { prompt: '', thread_id: threadId, messages: [], input: {}, a2ui_messages: [message], metadata, confirmed }, active.signal, receive)
        } else await streamAgent(threadId, [], active.signal, receive, { a2uiMessages: [message], metadata })
        if (failure) throw new Error(failure)
      } finally { uiControllers.current.delete(active) }
    })
    return () => { closed = true; for (const active of controllers) active.abort(); controllers.clear(); runtime.setDelivery(undefined) }
    // handleEvent uses this session's normalizer/agent plus React state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizer, selectedAgent, threadId])

  const send = async (text = input) => {
    const structured = selectedAgent && hasStructuredInput(selectedAgent)
    const clean = text.trim() || (structured ? tool || 'Run query' : '')
    if (!clean || running) return
    let args: Record<string, unknown> = {}
    if (structured) {
      try {
        args = JSON.parse(queryInput)
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Input must be a JSON object.')
      } catch { addResults([{ id: crypto.randomUUID(), kind: 'error', text: 'Enter valid JSON object arguments.' }]); return }
      if (selectedAgent.discovery.tools?.length && !tool) { addResults([{ id: crypto.randomUUID(), kind: 'error', text: 'Select a tool first.' }]); return }
    }
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: clean }
    const next = [...messages, user]
    const active = new AbortController()
    controller.current = active
    setMessages(next); setInput(''); setConfirmed(false); setRunning(true); setView('chat')
    setActivities((items) => [...items, { id: crypto.randomUUID(), name: selectedAgent?.name || 'ADK coordinator', status: 'running', startedAt: new Date().toISOString() }])
    let terminal = false
    const onEvent = (event: ProtocolEvent) => { if (['RUN_FINISHED', 'RUN_ERROR'].includes(String(event.type))) terminal = true; if (!active.signal.aborted && controller.current === active) handleEvent(event) }
    try {
      const history = next.filter((item) => item.id !== 'welcome').map(({ id, role, content }) => ({ id, role, content }))
      if (selectedAgent) {
        await runConnection(selectedAgent.id, { prompt: clean, thread_id: threadId, messages: history, input: args, tool: tool || undefined, confirmed, state: agentState.current, metadata: normalizer.a2ui.metadata(selectedAgent.id) }, active.signal, onEvent)
      } else {
        await streamAgent(threadId, history, active.signal, onEvent, { metadata: normalizer.a2ui.metadata('coordinator') })
      }
      if (!terminal && !active.signal.aborted) onEvent({ type: 'RUN_ERROR', message: 'The stream ended before the run completed.' })
    } catch (reason) {
      if (!active.signal.aborted && controller.current === active) onEvent({ type: 'RUN_ERROR', message: reason instanceof Error ? reason.message : 'Connection failed.' })
    } finally {
      if (controller.current === active) {
        setRunning(false)
        setMessages((items) => items.map((item) => ({ ...item, pending: false })))
      }
    }
  }

  const stop = () => {
    controller.current?.abort(); setRunning(false)
    setActivities((items) => items.map((item) => item.status === 'running' ? { ...item, status: 'cancelled' } : item))
  }
  const chooseView = (next: WorkspaceView) => { setView(next); setMobileNav(false) }
  const selectAgent = (agent: ConnectionRecord) => { newThread(); setSelectedAgent(agent); setTool(agent.discovery.tools?.find((entry) => entry.available !== false)?.name || ''); setInput(''); setView('chat') }
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); localStorage.setItem('relay-theme', next) }
  const attach = (file?: File) => {
    if (!file) return
    const kind: ResultBlock['kind'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file'
    addResults([{ id: crypto.randomUUID(), kind, name: file.name, title: file.name, mimeType: file.type, url: URL.createObjectURL(file), source: 'You' }])
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: `Local preview: ${file.name} (not uploaded)` }]); setCanvasOpen(true)
  }
  const exportCanvas = () => {
    const blob = new Blob([JSON.stringify({ results, surface, a2ui: normalizer.a2ui.export() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${surface.surfaceId}.json`; anchor.click(); URL.revokeObjectURL(url); setCanvasMenu(false)
  }
  const handleSurfaceAction = (name: string, context: unknown, data: Record<string, unknown>) => void send(`UI action: ${name}\nContext: ${JSON.stringify(context || {})}\nForm data: ${JSON.stringify(data)}`)

  const searched = search.trim().toLowerCase()
  const searchItems = searched ? [
    ...messages.filter((item) => item.content.toLowerCase().includes(searched)).map((item) => ({ label: item.content, action: () => { setView('chat'); setSearchOpen(false) } })),
    ...results.filter((item) => `${item.title || ''} ${item.name || ''} ${item.text || ''}`.toLowerCase().includes(searched)).map((item) => ({ label: item.title || item.name || item.kind, action: () => { if (item.surface) setSurface(item.surface); setView('dashboards'); setSearchOpen(false) } })),
  ] : []

  return <A2UIContext.Provider value={normalizer.a2ui}><div className={`app-shell ${theme} ${canvasFull ? 'canvas-full' : ''}`}>
    <nav className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Command size={18} /></div><span>Relay</span><small>ADK</small></div>
      <button className="new-thread" onClick={newThread}><Plus size={17} /> New thread <kbd>⌘ K</kbd></button>
      <div className="nav-group"><span>Workspace</span>{nav.map((item) => <button className={view === item.id ? 'active' : ''} onClick={() => chooseView(item.id)} key={item.id}><item.icon size={18} /> {item.label}{item.id === 'runs' && activities.length > 0 && <b>{activities.length}</b>}</button>)}</div>
      <div className="nav-group"><span>Manage</span><button onClick={() => setDrawerOpen(true)}><Users size={18} /> Connections{agentCount > 0 && <b>{agentCount}</b>}</button>{manage.map((item) => <button className={view === item.id ? 'active' : ''} onClick={() => chooseView(item.id)} key={item.id}><item.icon size={18} /> {item.label}</button>)}</div>

      <div className="sidebar-bottom"><button className={view === 'settings' ? 'active' : ''} onClick={() => chooseView('settings')}><Settings2 size={18} /> Settings</button><button className="profile" onClick={() => chooseView('settings')}><div>RR</div><span><strong>Workspace</strong><small>{selectedAgent ? selectedAgent.name : 'ADK coordinator'}</small></span><ChevronDown size={15} /></button></div>
    </nav>

    <main>
      <header><button className="icon-button menu-button" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div><span className="eyebrow">Agentic workspace</span><h1>{view[0].toUpperCase() + view.slice(1)}</h1></div><div className="header-actions"><button className="search" onClick={() => setSearchOpen(true)}><Search size={17} /> Search <kbd>⌘ /</kbd></button><button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}</button><button className="agents-button" onClick={() => setDrawerOpen(true)}><span className="status-dot" /> {agentCount + 1} agent{agentCount ? 's' : ''} <ChevronDown size={14} /></button><button className="icon-button" onClick={() => setCanvasOpen(!canvasOpen)}>{canvasOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>

      {view === 'chat' ? <div className={`workspace ${canvasOpen ? '' : 'canvas-collapsed'}`}>
        <section className="chat-panel">
          {selectedAgent && <div className="agent-mode"><Bot size={14} /><span>Direct to <strong>{selectedAgent.name}</strong> via {selectedAgent.kind.toUpperCase()}</span><button onClick={newThread}><X size={13} /> Use coordinator</button></div>}
          <div className="messages"><div className="day-label"><span>Today</span></div>{messages.map((message) => <article className={`message ${message.role}`} key={message.id}>{message.role === 'assistant' && <div className="message-avatar"><Sparkles size={16} /></div>}<div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? selectedAgent?.name || 'Relay' : 'You'}</strong><span>now</span>{message.role === 'assistant' && <em>{selectedAgent ? selectedAgent.kind.toUpperCase() : 'ADK'}</em>}</div><Markdown text={message.content || (message.pending ? 'Thinking…' : '')} /></div></article>)}{activities.length > 0 && <div className="activity-stack">{activities.map((item) => <div key={item.id}><span className={item.status}>{item.status === 'complete' ? <Check size={12} /> : <i />}</span><p><strong>{item.status === 'complete' ? 'Completed' : item.status === 'error' ? 'Failed' : item.status === 'cancelled' ? 'Cancelled' : 'Running'}:</strong> {item.name}</p></div>)}</div>}{!selectedAgent && messages.length === 1 && <div className="starters">{starters.map((starter) => <button key={starter} onClick={() => void send(starter)}>{starter}<ArrowUp size={14} /></button>)}</div>}</div>
          <div className="composer-wrap">{selectedAgent && <ConnectionInput connection={selectedAgent} tool={tool} onTool={(value) => { setTool(value); setConfirmed(false) }} input={queryInput} onInput={(value) => { setQueryInput(value); setConfirmed(false) }} confirmed={confirmed} onConfirmed={setConfirmed} />}<div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={selectedAgent ? `Message ${selectedAgent.name}…` : 'Ask anything, or describe a dashboard…'} rows={1} /><div className="composer-actions"><div><button className="icon-button" onClick={() => fileInput.current?.click()} aria-label="Preview local file"><Paperclip size={18} /></button><input ref={fileInput} type="file" hidden onChange={(event) => attach(event.target.files?.[0])} /><div className="model-menu-wrap"><button className="model-pill" onClick={() => setModelOpen(!modelOpen)}><Bot size={15} /> {selectedAgent?.name || 'Gemini 3 Flash'} <ChevronDown size={13} /></button>{modelOpen && <div className="model-menu"><button onClick={() => { newThread(); setModelOpen(false) }}><Check size={13} /> Gemini 3 Flash · ADK</button><button onClick={() => { setDrawerOpen(true); setModelOpen(false) }}><Plus size={13} /> Connect agent or data service</button></div>}</div></div>{running ? <button className="send-button stop" onClick={stop} aria-label="Stop run"><CircleStop size={17} /></button> : <button className="send-button" aria-label="Send" disabled={!input.trim() && !selectedAgent} onClick={() => void send()}><ArrowUp size={18} /></button>}</div></div><small>Relay may make mistakes. Review important actions.</small></div>
        </section>
        {canvasOpen && <section className="canvas-panel"><div className="canvas-head"><div><AppWindow size={16} /><span>Canvas</span><i>Live</i></div><div><button onClick={() => setCanvasFull(!canvasFull)}>{canvasFull ? 'Exit preview' : 'Preview'}</button><div className="canvas-menu-wrap"><button onClick={() => setCanvasMenu(!canvasMenu)} aria-label="Canvas menu"><MoreHorizontal size={16} /></button>{canvasMenu && <div className="canvas-menu"><button onClick={exportCanvas}><Download size={13} /> Export JSON</button><button onClick={() => { setSurface(emptySurface); setResults([]); normalizer.a2ui.dispose(); setNormalizer(new ResultNormalizer()); setCanvasMenu(false) }}>Clear canvas</button></div>}</div></div></div><div className="canvas-title"><div><span className="eyebrow">Dynamic result</span><h2>{surface.surfaceId.replaceAll('-', ' ')}</h2><p>Native, safe rendering from the active agent.</p></div><span className="updated"><i /> {running ? 'Receiving results' : results.length ? 'Results available' : 'Awaiting results'}</span></div>{results.length === 0 && <p className="muted">Connect a service and run a query. Its results will appear here.</p>}{results.map((block) => <div className="canvas-result" key={block.id}><ResultRenderer block={block} onAction={handleSurfaceAction} /></div>)}<div className="canvas-foot"><span><ShieldIcon /> Dynamic protocol renderer</span><span>OpenAPI · MCP · AG-UI · A2A · Adapters</span></div></section>}
      </div> : <WorkspacePage view={view} results={results} activities={activities} events={events} surface={surface} onSurface={setSurface} onChat={() => setView('chat')} theme={theme} onTheme={toggleTheme} onAction={handleSurfaceAction} />}
    </main>

    {drawerOpen && <AgentDrawer onClose={() => setDrawerOpen(false)} onUseAgent={selectAgent} onChanged={setAgentCount} />}
    {drawerOpen && <button className="scrim" onClick={() => setDrawerOpen(false)} aria-label="Close drawer" />}
    {searchOpen && <div className="modal-backdrop" onClick={() => setSearchOpen(false)}><section className="search-modal" onClick={(event) => event.stopPropagation()}><div><Search size={18} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages and results" /><button className="icon-button" onClick={() => setSearchOpen(false)}><X size={16} /></button></div><div className="search-results">{searched && searchItems.length === 0 && <p>No matching workspace content.</p>}{searchItems.map((item, index) => <button onClick={item.action} key={index}>{item.label}</button>)}</div></section></div>}
  </div></A2UIContext.Provider>
}

function WorkspacePage({ view, results, activities, events, surface, onSurface, onChat, theme, onTheme, onAction }: { view: WorkspaceView; results: ResultBlock[]; activities: ActivityItem[]; events: ProtocolEvent[]; surface: A2UISurface; onSurface: (surface: A2UISurface) => void; onChat: () => void; theme: string; onTheme: () => void; onAction: (name: string, context: unknown, data: Record<string, unknown>) => void }) {
  const surfaces = results
  const artifacts = results.filter((item) => ['image', 'audio', 'video', 'file'].includes(item.kind))
  return <div className="page-view"><div className="page-heading"><span className="eyebrow">Workspace</span><h2>{view[0].toUpperCase() + view.slice(1)}</h2><p>Everything produced by local and remote agents is normalized into this workspace.</p></div>
    {view === 'dashboards' && <div className="result-grid">{surfaces.length ? surfaces.map((block) => <article className="result-card" key={block.id}><div><strong>{block.title}</strong><span>{block.source}</span></div><ResultRenderer block={block} onAction={onAction} onExpand={() => { if (block.surface) onSurface(block.surface); onChat() }} /></article>) : <Empty label="No generated dashboards yet" action={onChat} />}</div>}
    {view === 'runs' && <div className="data-list">{activities.length ? activities.map((item) => <article key={item.id}><span className={`run-state ${item.status}`} /><div><strong>{item.name}</strong><small>{item.detail || 'Agent execution'}</small></div><em>{item.status}</em></article>) : <Empty label="No runs in this thread" action={onChat} />}</div>}
    {view === 'artifacts' && <div className="artifact-grid">{artifacts.length ? artifacts.map((block) => <ResultRenderer block={block} key={block.id} />) : <Empty label="Files and media returned by agents appear here" action={onChat} />}</div>}
    {view === 'tools' && <div className="settings-grid"><section><h3>Protocol adapters</h3><p>Connect A2A, AG-UI, HTTP/JSON, MCP, OpenAPI, or a trusted installed adapter. The client discovers adapter capabilities and operation schemas from the gateway; new adapters need no frontend rebuild.</p><div className="chip-row"><span>Text</span><span>JSON</span><span>Tables</span><span>Images</span><span>Audio</span><span>Video</span><span>Files</span><span>A2UI</span></div></section><section><h3>Unknown output</h3><p>Unrecognized structured results are displayed as an expandable JSON inspector instead of being discarded.</p></section></div>}
    {view === 'activity' && <div className="event-log">{events.length ? [...events].reverse().map((event, index) => <details key={index}><summary><span>{String(event.type || 'EVENT')}</span><small>{new Date().toLocaleTimeString()}</small></summary><pre>{JSON.stringify(event, null, 2)}</pre></details>) : <Empty label="Protocol events appear here while agents run" action={onChat} />}</div>}
    {view === 'settings' && <div className="settings-grid"><section><h3>Appearance</h3><p>Current theme: {theme}</p><button className="primary-action" onClick={onTheme}>{theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</button></section><section><h3>Renderer policy</h3><p>Generated content stays declarative. Unknown components fall back to an inspectable payload and arbitrary code is never executed.</p></section><section><h3>Active canvas</h3><p>{surface.surfaceId} · {surface.components.length} components</p></section></div>}
  </div>
}

function Empty({ label, action }: { label: string; action: () => void }) { return <div className="page-empty"><AppWindow size={26} /><strong>{label}</strong><button onClick={action}>Open chat</button></div> }
function ShieldIcon() { return <span className="shield">✓</span> }
export default App
