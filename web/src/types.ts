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
  status: 'running' | 'complete' | 'error' | 'cancelled'
  detail?: string
  startedAt?: string
  endedAt?: string
}

export type ProtocolEvent = Record<string, unknown> & { type?: string }


export type ResultBlock = {
  children?: ResultBlock[]
  columns?: number
  original?: unknown
  id: string
  kind: string
  title?: string
  text?: string
  data?: unknown
  url?: string
  mimeType?: string
  name?: string
  xKey?: string
  yKey?: string
  surfaceId?: string
  surface?: A2UISurface
  source?: string
}
