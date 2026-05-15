import { ConcurrencyManager, CircuitBreaker, detectToolCallLoop } from "./manager"

export interface BackgroundHook {
  "tool.execute.before": (input: { sessionID: string; tool: string; args: any; toolHistory?: Array<{ tool: string; args?: Record<string, unknown> }> }) => Promise<{ cancel?: boolean; reason?: string } | void>
  "tool.execute.after": (input: { sessionID: string; tool: string; error?: any }) => Promise<void>
}

export function createBackgroundHook(): BackgroundHook {
  const concurrency = new ConcurrencyManager(5)
  const circuitBreaker = new CircuitBreaker(30000)

  const hook: BackgroundHook = {
    "tool.execute.before": async (input) => {
      const { tool, toolHistory, sessionID } = input

      // Circuit breaker check for background agent tools
      if (tool === "task" || tool === "call_omo_agent") {
        if (!circuitBreaker.checkCircuit(sessionID)) {
          return { cancel: true, reason: `Circuit breaker open for session ${sessionID}` }
        }

        // Enforce concurrency limits: refuse if too many tasks are active
        const activeCount = concurrency.getActiveCount(sessionID)
        if (activeCount >= concurrency.maxPerKey) {
          return {
            cancel: true,
            reason: `Concurrency limit reached for session ${sessionID}: ${activeCount} active tasks (max ${concurrency.maxPerKey})`,
          }
        }

        // Track the task as active in the concurrency manager
        concurrency.enqueue(sessionID, async () => {
          // The actual task execution is handled by the runtime;
          // this wrapper tracks completion via the "after" hook
        })
      }

      // Tool-call loop detection
      if (toolHistory && toolHistory.length >= 5) {
        const loop = detectToolCallLoop(toolHistory)
        if (loop.isLoop) {
          circuitBreaker.recordFailure(sessionID)
          return { cancel: true, reason: `Detected tool-call loop: ${loop.tool} called ${loop.count} times consecutively` }
        }
      }

      return undefined
    },

    "tool.execute.after": async (input) => {
      const { tool, error, sessionID } = input

      // Decrement active count for tracked tasks
      if (tool === "task" || tool === "call_omo_agent") {
        concurrency.dequeue(sessionID)
      }

      if (error) {
        circuitBreaker.recordFailure(sessionID)
      } else {
        circuitBreaker.recordSuccess(sessionID)
      }
    },
  }

  return hook
}
