export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

export type WorkspaceView = 'chat' | 'dashboards' | 'runs' | 'artifacts' | 'tools' | 'activity' | 'settings'

export type AgentRecord = {
  id: string
  name: string
  description: string
  baseUrl: string
  status: string
  card: Record<string, unknown>
  createdAt: string
}

export type A2UIComponent = {
  id: string
  component: string
  children?: string[]
  child?: string
  text?: string | { path: string }
  label?: string
  value?: unknown
  variant?: string
  [key: string]: unknown
}

export type A2UISurface = {
  surfaceId: string
  components: A2UIComponent[]
  data?: Record<string, unknown>
}

export type Activity = {
  id: string
  name: string
  status: 'running' | 'complete' | 'error'
  detail?: string
  startedAt?: string
  endedAt?: string
}

export type ProtocolEvent = Record<string, unknown> & { type?: string }


export type ResultBlock = {
  id: string
  kind: 'text' | 'markdown' | 'json' | 'table' | 'image' | 'audio' | 'video' | 'file' | 'a2ui' | 'error' | 'status'
  title?: string
  text?: string
  data?: unknown
  url?: string
  mimeType?: string
  name?: string
  surface?: A2UISurface
  source?: string
}
