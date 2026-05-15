export interface BackgroundConcurrency {
  maxPerKey: number // 5
  queues: Map<string, Array<() => Promise<void>>> // key → pending tasks
  active: Map<string, number> // key → active count
}

export interface CircuitBreakerState {
  failureCount: number
  lastFailureAt: number
  isOpen: boolean
  resetAfterMs: number // 30000
}

export interface StabilityConfig {
  idleSettleMs: number // 3000
  checkIntervalMs: number // 500
}

export interface SessionStatus {
  status: string
  messageCount?: number
}
