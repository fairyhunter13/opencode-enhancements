export { TodoContinuationEnforcer } from "./enforcer"
export { createContinuationHook } from "./hook"
export type { Todo, ContinuationState, ContinuationEnforcerOptions } from "./types"
export {
  CONTINUATION_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_STAGNATION_COUNT,
  COMPACTION_GUARD_MS,
  IDLE_SETTLE_MS,
  SKIP_AGENTS,
} from "./types"
