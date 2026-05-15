import type { CompactionCheckpoint } from "./types"

export interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

const checkpoints = new Map<string, CompactionCheckpoint>()

export function captureCheckpoint(
  sessionID: string,
  agent: string,
  model: string,
  tools: string[],
): void {
  checkpoints.set(sessionID, {
    agent,
    model,
    tools,
    timestamp: Date.now(),
  })
}

export function restoreCheckpoint(
  sessionID: string,
): CompactionCheckpoint | null {
  return checkpoints.get(sessionID) ?? null
}

export function clearCheckpoint(sessionID: string): void {
  checkpoints.delete(sessionID)
}

export function buildCompactionContext(
  checkpoint: CompactionCheckpoint,
  todos: Todo[],
): string {
  const incompleteTodos = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
  const completedTodos = todos.filter((t) => t.status === "completed")

  const lines: string[] = [
    "## Compaction Context (Auto-Restored)",
    "",
    "### Context Snapshot",
    `- Agent: ${checkpoint.agent}`,
    `- Model: ${checkpoint.model}`,
    `- Tools: ${checkpoint.tools.join(", ")}`,
    `- Captured: ${new Date(checkpoint.timestamp).toISOString()}`,
    "",
    "### User Requests",
    "<summarize the user's original requests here>",
    "",
    "### Final Goal",
    "<describe the ultimate goal here>",
    "",
  ]

  if (completedTodos.length > 0) {
    lines.push("### Work Completed", "")
    for (const todo of completedTodos) {
      lines.push(`- ✅ ${todo.content}`)
    }
    lines.push("")
  }

  if (incompleteTodos.length > 0) {
    lines.push("### Remaining Tasks", "")
    for (const todo of incompleteTodos) {
      lines.push(`- [ ] ${todo.content}`)
    }
    lines.push("")
  }

  lines.push(
    "### Active Context",
    "<describe current state, in-progress work, and decisions made>",
    "",
    "Continue working. Do NOT repeat completed work.",
  )

  return lines.join("\n")
}

export function detectNoTextTail(messages: any[]): boolean {
  if (!messages || messages.length < 5) return false

  let consecutive = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role !== "assistant") {
      break
    }

    const hasText = msg.parts?.some(
      (p: any) => p.type === "text" && p.text?.trim().length > 0,
    )
    if (hasText) {
      break
    }

    consecutive++
    if (consecutive >= 5) return true
  }

  return false
}
