export type ConnectionKind = string
export type AdapterDescriptor = { kind: string; label: string; contractVersion: string; configSchema: Record<string, unknown>; capabilities: string[]; requiresEndpoint?: boolean }
export type ToolDefinition = { name: string; description?: string; inputSchema: Record<string, unknown>; available?: boolean; reason?: string; method?: string; requiresConfirmation?: boolean }
export type ConnectionSpec = {
  name: string
  kind: ConnectionKind
  url: string
  description?: string
  config?: Record<string, unknown>
  a2ui_tool?: string | null
  auth?: { env: string; header: string; prefix: string } | null
  http?: { method: 'GET' | 'POST'; body: Record<string, unknown>; response_path: string; input_schema?: Record<string, unknown> }
}
export type ConnectionRecord = ConnectionSpec & {
  id: string
  discovery: { adapter?: AdapterDescriptor; verified: boolean; tools?: ToolDefinition[]; note?: string; protocolVersion?: string }
}
export type ConnectionRun = {
  prompt: string
  thread_id: string
  messages: { id: string; role: string; content: string }[]
  input: Record<string, unknown>
  tool?: string
  confirmed?: boolean
  state?: Record<string, unknown>
  a2ui_messages?: Record<string, unknown>[]
  metadata?: Record<string, unknown>
  task_id?: string
}
