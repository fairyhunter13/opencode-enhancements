import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import type { BoulderState, BoulderWorkState, PlanProgress, CurrentTask, TaskSessionState } from "./types"

const BOULDER_DIR = ".opencode"
const BOULDER_FILE = "boulder.json"

export function getBoulderFilePath(directory: string): string {
  return join(directory, BOULDER_DIR, BOULDER_FILE)
}

export function readBoulderState(directory: string): BoulderState | null {
  const filePath = getBoulderFilePath(directory)

  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

    const state = parsed as BoulderState

    // Ensure works object exists
    if (!state.works || typeof state.works !== "object") {
      state.works = {}
    }

    return state
  } catch {
    return null
  }
}

export function writeBoulderState(directory: string, state: BoulderState): boolean {
  const filePath = getBoulderFilePath(directory)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Atomic write: temp file + rename
    const tmpPath = filePath + ".tmp." + Date.now()
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8")
    renameSync(tmpPath, filePath)

    return true
  } catch {
    return false
  }
}

export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: false }
  }

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)

    let total = 0
    let completed = 0
    let inTodos = false

    for (const line of lines) {
      // Track ## TODOs section
      if (/^##\s/.test(line)) {
        inTodos = /^##\s+TODOs\b/i.test(line)
        continue
      }

      if (!inTodos) continue

      const uncheckedMatch = line.match(/^\s*[-*]\s*\[\s*\]\s*(.+)$/)
      const checkedMatch = line.match(/^\s*[-*]\s*\[[xX]\]\s*(.+)$/)

      if (checkedMatch) {
        total++
        completed++
      } else if (uncheckedMatch) {
        total++
      }
    }

    return {
      total,
      completed,
      isComplete: total > 0 && completed === total,
    }
  } catch {
    return { total: 0, completed: 0, isComplete: false }
  }
}

export function getCurrentTask(planPath: string): CurrentTask | null {
  if (!existsSync(planPath)) return null

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)

    let inTodos = false
    let taskIndex = 1

    for (const line of lines) {
      if (/^##\s/.test(line)) {
        inTodos = /^##\s+TODOs\b/i.test(line)
        if (!inTodos) taskIndex = 1
        continue
      }

      if (!inTodos) continue

      const match = line.match(/^\s*[-*]\s*\[\s*\]\s*(.+)$/)
      if (match) {
        const title = match[1]!.trim()
        // Extract numbered label if present (e.g., "1. Setup database")
        const labelMatch = title.match(/^(\d+)\.\s+(.+)$/)
        const label = labelMatch ? labelMatch[1]! : String(taskIndex)
        const cleanTitle = labelMatch ? labelMatch[2]!.trim() : title

        return {
          key: `todo:${label.toLowerCase()}`,
          label,
          title: cleanTitle,
        }
      }

      // Track numbered tasks even without checkbox
      const numberedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/)
      if (numberedMatch) {
        taskIndex = parseInt(numberedMatch[1]!, 10) + 1
      }
    }

    return null
  } catch {
    return null
  }
}

export function getElapsedMs(work: BoulderWorkState): number {
  const startMs = new Date(work.startedAt).getTime()
  if (isNaN(startMs)) return 0

  const endMs = work.endedAt ? new Date(work.endedAt).getTime() : Date.now()
  if (isNaN(endMs)) return 0

  return Math.max(0, endMs - startMs)
}
