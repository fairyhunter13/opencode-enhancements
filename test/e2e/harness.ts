/**
 * Self-contained E2E test harness for opencode-enhancements.
 *
 * Provides a MockOpencodeClient, temp directory management, and helpers
 * to simulate plugin events and hooks — all without a real opencode server.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

// ── Captured call types ──────────────────────────────────────────────────

export interface CapturedCall {
  hook: string
  input: unknown
  output?: unknown
  timestamp: number
}

export interface PromptCall {
  sessionID: string
  parts: Array<{ type: string; text: string }>
  agent?: string
}

// ── Mock client ──────────────────────────────────────────────────────────

export interface MockSessionClient {
  promptAsync: (opts: {
    path: { id: string }
    body: { agent?: string; parts: Array<{ type: string; text: string }> }
  }) => Promise<{ id: string }>
  messages: (opts: { path: { id: string } }) => Promise<Array<Record<string, unknown>>>
  create: (opts?: { agent?: string }) => Promise<{ id: string }>
  status: (opts: { path: { id: string } }) => Promise<{ status: string }>
  todo: (opts: { path: { id: string } }) => Promise<Array<{ content: string; status: string; priority: string }>>
}

export interface MockTuiClient {
  showToast: (opts: { message: string; type?: string }) => void
}

export interface MockOpencodeClient {
  session: MockSessionClient
  tui: MockTuiClient
  captures: CapturedCall[]
  /** Resets all recorded captures */
  reset: () => void
  /** Get all prompt calls */
  getPromptCalls: () => PromptCall[]
  /** Get all toast calls */
  getToastCalls: () => Array<{ message: string; type?: string }>
}

export function createMockClient(): MockOpencodeClient {
  const captures: CapturedCall[] = []

  const session: MockSessionClient = {
    promptAsync: async (opts) => {
      captures.push({ hook: "session.promptAsync", input: opts, timestamp: Date.now() })
      return { id: opts.path.id }
    },
    messages: async (_opts) => {
      captures.push({ hook: "session.messages", input: _opts, timestamp: Date.now() })
      return []
    },
    create: async (_opts) => {
      captures.push({ hook: "session.create", input: _opts, timestamp: Date.now() })
      return { id: "mock-session-id" }
    },
    status: async (_opts) => {
      captures.push({ hook: "session.status", input: _opts, timestamp: Date.now() })
      return { status: "idle" }
    },
    todo: async (_opts) => {
      captures.push({ hook: "session.todo", input: _opts, timestamp: Date.now() })
      return []
    },
  }

  const tui: MockTuiClient = {
    showToast: (opts) => {
      captures.push({ hook: "tui.showToast", input: opts, timestamp: Date.now() })
    },
  }

  return {
    session,
    tui,
    captures,
    reset: () => { captures.length = 0 },
    getPromptCalls: () =>
      captures
        .filter((c) => c.hook === "session.promptAsync")
        .map((c) => {
          const input = c.input as {
            path: { id: string }
            body: { agent?: string; parts: Array<{ type: string; text: string }> }
          }
          return { sessionID: input.path.id, parts: input.body.parts, agent: input.body.agent }
        }),
    getToastCalls: () =>
      captures
        .filter((c) => c.hook === "tui.showToast")
        .map((c) => c.input as { message: string; type?: string }),
  }
}

// ── Temp directory management ────────────────────────────────────────────

export interface TempDir {
  path: string
  cleanup: () => void
}

export function createTempDir(prefix = "opencode-e2e-"): TempDir {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    path: dir,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    },
  }
}

// ── Plugin input builder ─────────────────────────────────────────────────

export interface PluginInput {
  client: MockOpencodeClient
  directory: string
  worktree: string
}

export function createPluginInput(client: MockOpencodeClient, directory: string): PluginInput {
  return {
    client,
    directory,
    worktree: directory,
  }
}

// ── Event simulation ─────────────────────────────────────────────────────

/**
 * Simulates an event through a hook's event handler.
 * Builds the proper Event shape for each event type.
 */
export function simulateEvent(
  eventHandler: (input: { event: { id: string; type: string; properties: Record<string, unknown> } }) => Promise<void>,
  type: string,
  properties: Record<string, unknown>,
): Promise<void> {
  return eventHandler({
    event: {
      id: `evt_${Date.now()}`,
      type,
      properties,
    },
  })
}

// ── Tool call simulation ─────────────────────────────────────────────────

export interface ToolCallInput {
  tool: string
  sessionID: string
  callID: string
  args?: Record<string, unknown>
  error?: unknown
  toolHistory?: Array<{ tool: string; args?: Record<string, unknown> }>
}

export interface ToolCallOutput {
  args?: any
  title?: string
  output?: string
  metadata?: any
}

export function simulateToolBefore(
  hook: ((input: ToolCallInput, output: ToolCallOutput) => Promise<void>) | undefined,
  tool: string,
  sessionID = "test-session",
  args?: Record<string, unknown>,
  toolHistory?: Array<{ tool: string; args?: Record<string, unknown> }>,
): Promise<void> {
  if (!hook) return Promise.resolve()
  const output: ToolCallOutput = { args: args ?? {} }
  return hook(
    { tool, sessionID, callID: `call_${Date.now()}`, args, toolHistory },
    output,
  )
}

export function simulateToolAfter(
  hook: ((input: ToolCallInput, output: ToolCallOutput) => Promise<void>) | undefined,
  tool: string,
  sessionID = "test-session",
  args?: Record<string, unknown>,
  error?: unknown,
): Promise<void> {
  if (!hook) return Promise.resolve()
  const output: ToolCallOutput = { output: "", title: "", metadata: {} }
  return hook(
    { tool, sessionID, callID: `call_${Date.now()}`, args, error },
    output,
  )
}

// ── Chat message simulation ──────────────────────────────────────────────

export interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
  variant?: string
}

export interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

export function simulateChatMessage(
  hook:
    | ((input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>)
    | undefined,
  text: string,
  sessionID = "test-session",
): Promise<void> {
  if (!hook) return Promise.resolve()
  const output: ChatMessageOutput = {
    message: { id: "msg_1", role: "user", content: text },
    parts: [{ type: "text", text }],
  }
  return hook(
    { sessionID, messageID: "msg_1", variant: "test" },
    output,
  )
}

// ── System transform simulation ──────────────────────────────────────────

export interface SystemTransformInput {
  sessionID?: string
  model: { providerID: string; modelID: string }
}

export interface SystemTransformOutput {
  system: string[]
}

export function simulateSystemTransform(
  hook: ((input: SystemTransformInput, output: SystemTransformOutput) => Promise<void>) | undefined,
  system: string[] = [],
  model = { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
): Promise<{ system: string[] }> {
  if (!hook) return Promise.resolve({ system })
  const output: SystemTransformOutput = { system }
  return hook({ model } as SystemTransformInput, output).then(() => output)
}

// ── Compaction simulation ────────────────────────────────────────────────

export interface CompactingInput {
  sessionID: string
  agent?: string
  model?: string
  tools?: string[]
}

export function simulateCompacting(
  hook: ((input: CompactingInput) => Promise<void>) | undefined,
  sessionID = "test-session",
  agent = "orchestrator",
  model = "claude-sonnet-4-20250514",
  tools: string[] = ["Read", "Edit", "Bash"],
): Promise<void> {
  if (!hook) return Promise.resolve()
  return hook({ sessionID, agent, model, tools })
}

// ── Session idle simulation ──────────────────────────────────────────────

export interface SessionIdleInput {
  sessionID: string
  messages?: any[]
  todos?: Array<{ content: string; status: string; priority: string; id?: string }>
  info?: Record<string, unknown>
}

export function simulateSessionIdle(
  eventHandler: (input: { event: { id: string; type: string; properties: Record<string, unknown> } }) => Promise<void>,
  sessionID = "test-session",
  todos?: Array<{ content: string; status: string; priority: string }>,
): Promise<void> {
  return simulateEvent(eventHandler, "session.idle", {
    sessionID,
    info: { id: sessionID },
    todos,
  })
}

// ── Session error simulation ─────────────────────────────────────────────

export interface SessionErrorProperties {
  sessionID?: string
  error?: { name?: string; message?: string; data?: unknown }
}

export function simulateSessionError(
  eventHandler: (input: { event: { id: string; type: string; properties: Record<string, unknown> } }) => Promise<void>,
  sessionID = "test-session",
  error?: { name?: string; message?: string },
): Promise<void> {
  return simulateEvent(eventHandler, "session.error", {
    sessionID,
    error,
  })
}

// ── Session compacted simulation ─────────────────────────────────────────

export function simulateSessionCompacted(
  eventHandler: (input: { event: { id: string; type: string; properties: Record<string, unknown> } }) => Promise<void>,
  sessionID = "test-session",
): Promise<void> {
  return simulateEvent(eventHandler, "session.compacted", { sessionID })
}

// ── Session created simulation ───────────────────────────────────────────

export function simulateSessionCreated(
  eventHandler: (input: { event: { id: string; type: string; properties: Record<string, unknown> } }) => Promise<void>,
  sessionID = "test-session",
  directory?: string,
): Promise<void> {
  return simulateEvent(eventHandler, "session.created", { sessionID, directory })
}
