import type { CompactionCheckpoint, CompactionGuardState } from "./types"
import { captureCheckpoint, restoreCheckpoint, buildCompactionContext, detectNoTextTail, clearCheckpoint } from "./guard"

export type TodoItem = { content: string; status: string; priority: string; id: string }

export interface CompactionGuardHook {
  "experimental.session.compacting": (input: { sessionID: string; agent?: string; model?: string; tools?: string[] }) => Promise<void>
  "session.idle": (input: { sessionID: string; messages?: any[]; todos?: TodoItem[] }) => Promise<string | void>
  "tool.execute.before": (input: { tool: string; args: any }) => Promise<{ skip?: boolean } | void>
}

export function createCompactionGuardHook(): CompactionGuardHook {
  const state: CompactionGuardState = {
    checkpoints: new Map(),
    compactedSessions: new Set(),
    noTextTailCount: new Map(),
  }

  const savedTodos = new Map<string, TodoItem[]>()

  const hook: CompactionGuardHook = {
    "experimental.session.compacting": async (input) => {
      const { sessionID, agent, model, tools } = input
      if (agent && model) {
        captureCheckpoint(sessionID, agent, model, tools ?? [])
        state.compactedSessions.add(sessionID)
      }
    },

    "session.idle": async (input) => {
      const { sessionID, messages, todos } = input
      const results: string[] = []

      // Restore checkpoint and inject context
      if (state.compactedSessions.has(sessionID)) {
        const checkpoint = restoreCheckpoint(sessionID)
        if (checkpoint && todos && todos.length > 0) {
          const context = buildCompactionContext(checkpoint, todos)
          results.push(context)
        }
        state.compactedSessions.delete(sessionID)
      }

      // Detect no-text-tail and inject recovery
      if (messages && detectNoTextTail(messages)) {
        const prev = state.noTextTailCount.get(sessionID) ?? 0
        state.noTextTailCount.set(sessionID, prev + 1)

        results.push(
          "## Recovery Injection",
          "",
          "Detected repeated assistant messages without text output.",
          "This may indicate the agent lost context after compaction.",
          "Please re-state your goal and continue from where you left off.",
          "",
        )
      }

      // Restore todos from saved state
      const saved = savedTodos.get(sessionID)
      if (saved && (!todos || todos.length === 0)) {
        results.push(
          "## Preserved Todos",
          "",
          ...saved.map((t) => `- [${t.status === "completed" ? "x" : " "}] ${t.content}`),
          "",
        )
      }

      if (results.length > 0) {
        return results.join("\n")
      }
    },

    "tool.execute.before": async (input) => {
      if (input.tool === "todowrite" && Array.isArray(input.args?.todos)) {
        // Save todos before compaction can wipe them.
        // sessionID may not be available in all contexts; use "default" as fallback.
        const key = (input as any).sessionID ?? "default"
        savedTodos.set(key, input.args.todos as TodoItem[])
      }
    },
  }

  return hook
}
