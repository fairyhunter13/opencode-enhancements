export interface Todo {
  id?: string
  content: string
  status: string
  priority: string
}

export interface ContinuationState {
  sessionId: string
  failures: number
  lastInjectionAt: number
  stagnationCount: number
  compactionGuardUntil: number
  activitySignals: number
  lastActivityAt: number
  /** Tracks the count of incomplete todos from the last idle check, used for stagnation detection */
  lastIncompleteCount: number
}

export const CONTINUATION_COOLDOWN_MS = 5000
export const MAX_CONSECUTIVE_FAILURES = 5
export const MAX_STAGNATION_COUNT = 3
export const COMPACTION_GUARD_MS = 60000
export const IDLE_SETTLE_MS = 150
export const SKIP_AGENTS = ["compaction", "plan"]

/**
 * Plugin-level options accepted by the continuation enforcer factory.
 */
export interface ContinuationEnforcerOptions {
  /** Additional agent names to skip (appended to SKIP_AGENTS) */
  skipAgents?: string[]
}
