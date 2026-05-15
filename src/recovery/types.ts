export type RecoverableErrorType =
  | "tool_result_missing"
  | "unavailable_tool"
  | "thinking_block_order"
  | "thinking_disabled"
  | "context_length_exceeded"

export interface RecoveryResult {
  recovered: boolean
  errorType?: RecoverableErrorType
  strategy?: string
  canResume: boolean
  /** Human-readable description of the recovery action to perform */
  recoveryAction?: string
}

export interface SessionRecoveryOptions {
  /** Automatically resume session after successful recovery */
  autoResume?: boolean
  /** Cooldown in ms to prevent recovery loops (default: 5000) */
  recoveryCooldownMs?: number
  /** Additional agent names to skip recovery for */
  skipAgents?: string[]
}
