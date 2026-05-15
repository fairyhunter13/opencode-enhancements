export interface BoulderState {
  schemaVersion: 2
  activeWorkId?: string
  works: Record<string, BoulderWorkState>
}

export interface BoulderWorkState {
  workId: string
  activePlan: string // path to plan .md file
  planName: string
  status: "active" | "completed" | "paused" | "abandoned"
  startedAt: string
  endedAt?: string
  elapsedMs?: number
  sessionIds: string[]
  agent?: string
  taskSessions: Record<string, TaskSessionState>
}

export interface TaskSessionState {
  taskKey: string
  taskLabel: string
  taskTitle: string
  sessionId: string
  status: "running" | "completed" | "cancelled"
  startedAt?: string
  elapsedMs?: number
}

export interface PlanProgress {
  total: number
  completed: number
  isComplete: boolean
}

export interface CurrentTask {
  key: string
  label: string
  title: string
}
