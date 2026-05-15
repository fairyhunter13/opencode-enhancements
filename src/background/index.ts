export type { BackgroundConcurrency, CircuitBreakerState, StabilityConfig, SessionStatus } from "./types"
export { ConcurrencyManager, CircuitBreaker, waitForStable, detectToolCallLoop } from "./manager"
export { createBackgroundHook } from "./hook"
export type { BackgroundHook } from "./hook"
