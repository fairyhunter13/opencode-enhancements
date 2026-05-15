import type { BoulderState, BoulderWorkState, PlanProgress, CurrentTask } from "./types"
import { readBoulderState, writeBoulderState, getPlanProgress, getCurrentTask, getElapsedMs } from "./storage"

export interface BoulderHook {
  "tool.execute.after": (input: { sessionID: string; directory: string }) => Promise<void>
  "session.idle": (input: { sessionID: string; directory: string }) => Promise<string | void>
  "session.created": (input: { sessionID: string; directory: string }) => Promise<void>
}

export function createBoulderHook(): BoulderHook {
  const hook: BoulderHook = {
    "tool.execute.after": async (input) => {
      const { sessionID, directory } = input
      const state = readBoulderState(directory)
      if (!state?.activeWorkId) return

      const work = state.works[state.activeWorkId]
      if (!work || work.status !== "active") return

      // Re-read plan progress after tool execution
      const progress = getPlanProgress(work.activePlan)
      if (progress.isComplete) {
        work.status = "completed"
        work.endedAt = new Date().toISOString()
        work.elapsedMs = getElapsedMs(work)
        writeBoulderState(directory, state)
      }
    },

    "session.idle": async (input) => {
      const { sessionID, directory } = input
      const state = readBoulderState(directory)
      if (!state?.activeWorkId) return

      const work = state.works[state.activeWorkId]
      if (!work || work.status !== "active") return

      const progress = getPlanProgress(work.activePlan)
      if (progress.isComplete) return

      const currentTask = getCurrentTask(work.activePlan)
      if (!currentTask) return

      const lines: string[] = [
        "## Boulder Work Continuation",
        "",
        `### Active Work: ${work.planName}`,
        `- Work ID: ${work.workId}`,
        `- Agent: ${work.agent ?? "not specified"}`,
        `- Plan: ${work.activePlan}`,
        `- Elapsed: ${formatDuration(getElapsedMs(work))}`,
        "",
        `### Progress: ${progress.completed}/${progress.total} tasks`,
        "",
        `### Current Task: ${currentTask.label}. ${currentTask.title}`,
        "",
        "Continue working on this task. Do NOT repeat completed work.",
      ]

      return lines.join("\n")
    },

    "session.created": async (input) => {
      const { sessionID, directory } = input
      const state = readBoulderState(directory)
      if (!state?.activeWorkId) return

      const work = state.works[state.activeWorkId]
      if (!work) return

      // Register new session if not already present
      if (!work.sessionIds.includes(sessionID)) {
        work.sessionIds.push(sessionID)
        writeBoulderState(directory, state)
      }
    },
  }

  return hook
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
