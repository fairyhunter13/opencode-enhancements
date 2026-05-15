import type { Todo, ContinuationState } from "./types"
import {
  CONTINUATION_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_STAGNATION_COUNT,
  COMPACTION_GUARD_MS,
  SKIP_AGENTS,
} from "./types"

const CONTINUATION_PROMPT = `[TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done
- If you believe all work is already complete, the system is questioning your completion claim. Critically re-examine each todo item from a skeptical perspective, verify the work was actually done correctly, and update the todo list accordingly.`

export class TodoContinuationEnforcer {
  shouldInject(state: ContinuationState, todos: Todo[], sessionAgent: string, skipAgents?: string[]): boolean {
    const incompleteTodos = todos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "blocked" && t.status !== "deleted",
    )
    if (incompleteTodos.length === 0) return false

    if (state.failures >= MAX_CONSECUTIVE_FAILURES) return false
    if (state.stagnationCount >= MAX_STAGNATION_COUNT) return false

    const now = Date.now()
    if (now < state.compactionGuardUntil) return false

    const allSkipAgents = [...SKIP_AGENTS, ...(skipAgents ?? [])]
    if (allSkipAgents.includes(sessionAgent)) return false

    if (state.lastInjectionAt > 0) {
      const cooldown = this.calculateCooldown(state.failures)
      if (now - state.lastInjectionAt < cooldown) return false
    }

    return true
  }

  calculateCooldown(failures: number): number {
    return CONTINUATION_COOLDOWN_MS * Math.pow(2, Math.min(failures, 5))
  }

  buildContinuationPrompt(todos: Todo[]): string {
    const incompleteTodos = todos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "blocked" && t.status !== "deleted",
    )
    const total = todos.length
    const done = total - incompleteTodos.length
    const todoList = incompleteTodos.map((t) => `- [${t.status}] ${t.content}`).join("\n")

    return `${CONTINUATION_PROMPT}

[Status: ${done}/${total} completed, ${incompleteTodos.length} remaining]

Remaining tasks:
${todoList}`
  }

  detectStagnation(prevState: ContinuationState, newTodos: Todo[]): boolean {
    const prevIncomplete = prevState.lastIncompleteCount
    const currentIncomplete = newTodos.filter(
      (t) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "blocked" && t.status !== "deleted",
    ).length
    return currentIncomplete >= prevIncomplete
  }

  recordActivity(state: ContinuationState): void {
    state.stagnationCount = 0
    state.activitySignals += 1
    state.lastActivityAt = Date.now()
  }

  recordFailure(state: ContinuationState): void {
    state.failures += 1
  }

  resetState(): ContinuationState {
    return {
      sessionId: "",
      failures: 0,
      lastInjectionAt: 0,
      stagnationCount: 0,
      compactionGuardUntil: 0,
      activitySignals: 0,
      lastActivityAt: 0,
      lastIncompleteCount: 0,
    }
  }
}
