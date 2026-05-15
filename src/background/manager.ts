import type { BackgroundConcurrency, CircuitBreakerState, StabilityConfig, SessionStatus } from "./types"

export class ConcurrencyManager {
  private concurrency: BackgroundConcurrency

  constructor(maxPerKey = 5) {
    this.concurrency = {
      maxPerKey,
      queues: new Map(),
      active: new Map(),
    }
  }

  enqueue(key: string, task: () => Promise<void>): void {
    const active = this.concurrency.active.get(key) ?? 0
    if (active < this.concurrency.maxPerKey) {
      this.concurrency.active.set(key, active + 1)
      void task().finally(() => this.dequeue(key))
    } else {
      const queue = this.concurrency.queues.get(key) ?? []
      queue.push(task)
      this.concurrency.queues.set(key, queue)
    }
  }

  dequeue(key: string): void {
    const queue = this.concurrency.queues.get(key)
    if (queue && queue.length > 0) {
      const task = queue.shift()!
      if (queue.length === 0) {
        this.concurrency.queues.delete(key)
      }
      void task().finally(() => this.dequeue(key))
    } else {
      const active = this.concurrency.active.get(key) ?? 0
      if (active > 0) {
        this.concurrency.active.set(key, active - 1)
      }
      if (active <= 1) {
        this.concurrency.active.delete(key)
      }
    }
  }

  getActiveCount(key: string): number {
    return this.concurrency.active.get(key) ?? 0
  }

  getQueueLength(key: string): number {
    return this.concurrency.queues.get(key)?.length ?? 0
  }

  get maxPerKey(): number {
    return this.concurrency.maxPerKey
  }
}

export class CircuitBreaker {
  private states = new Map<string, CircuitBreakerState>()

  constructor(private defaultResetAfterMs = 30000) {}

  checkCircuit(key: string): boolean {
    const state = this.states.get(key)
    if (!state) return true

    if (state.isOpen) {
      const now = Date.now()
      if (now - state.lastFailureAt >= state.resetAfterMs) {
        // Auto-reset after cooldown
        state.isOpen = false
        state.failureCount = 0
        return true
      }
      return false
    }

    return true
  }

  recordFailure(key: string): void {
    const now = Date.now()
    let state = this.states.get(key)

    if (!state) {
      state = {
        failureCount: 1,
        lastFailureAt: now,
        isOpen: false,
        resetAfterMs: this.defaultResetAfterMs,
      }
      this.states.set(key, state)
      return
    }

    state.failureCount++
    state.lastFailureAt = now

    // Open after 3 consecutive failures
    if (state.failureCount >= 3) {
      state.isOpen = true
    }
  }

  recordSuccess(key: string): void {
    this.states.delete(key)
  }

  isOpen(key: string): boolean {
    return this.states.get(key)?.isOpen ?? false
  }

  reset(key: string): void {
    this.states.delete(key)
  }
}

export async function waitForStable(
  sessionId: string,
  getStatus: () => Promise<SessionStatus>,
  config: StabilityConfig = { idleSettleMs: 3000, checkIntervalMs: 500 },
): Promise<void> {
  let stablePolls = 0
  const requiredPolls = Math.ceil(config.idleSettleMs / config.checkIntervalMs)
  let lastMessageCount: number | undefined

  while (stablePolls < requiredPolls) {
    const status = await getStatus()
    const msgCount = status.messageCount

    if (msgCount !== undefined && msgCount === lastMessageCount) {
      stablePolls++
    } else {
      stablePolls = 0
    }

    lastMessageCount = msgCount

    if (stablePolls < requiredPolls) {
      await new Promise((resolve) => setTimeout(resolve, config.checkIntervalMs))
    }
  }
}

/**
 * Detect tool-call loops: 5+ identical consecutive tool calls.
 */
export function detectToolCallLoop(
  toolHistory: Array<{ tool: string; args?: Record<string, unknown> }>,
): { isLoop: boolean; tool?: string; count?: number } {
  if (toolHistory.length < 5) return { isLoop: false }

  const recent = toolHistory.slice(-5)
  const first = recent[0]!
  const allSame = recent.every(
    (t) => t.tool === first.tool && JSON.stringify(t.args ?? {}) === JSON.stringify(first.args ?? {}),
  )

  if (allSame) {
    return { isLoop: true, tool: first.tool, count: 5 }
  }

  return { isLoop: false }
}
