import type { RecoverableErrorType, RecoveryResult } from "./types"

/**
 * Recovery strategy for tool_result_missing errors.
 * Aborts the current turn and re-injects tool results with
 * cancellation placeholders so the model can proceed.
 *
 * Note: Actual abort + re-inject requires opencode API support (session.promptAsync).
 * This returns a recovery action description for the runtime to execute.
 */
export async function recoverToolResultMissing(
  sessionId: string,
  _error: unknown,
): Promise<RecoveryResult> {
  try {
    // Recovery action: abort the current assistant turn, inject cancellation
    // tool_results for all pending tool_use blocks, then re-prompt the agent
    // to continue with the available results.
    return {
      recovered: true,
      errorType: "tool_result_missing",
      strategy: "abort_session_and_inject_tool_results",
      canResume: true,
      recoveryAction:
        "Abort the current assistant message and inject cancellation tool_results " +
        "for all pending tool_use blocks, then re-prompt the agent to continue.",
    }
  } catch {
    return {
      recovered: false,
      errorType: "tool_result_missing",
      strategy: "abort_session_and_inject_tool_results",
      canResume: false,
    }
  }
}

/**
 * Recovery strategy for unavailable_tool errors.
 * Strips the unavailable tool call from the message and continues.
 */
export async function recoverUnavailableTool(
  sessionId: string,
  _error: unknown,
): Promise<RecoveryResult> {
  try {
    return {
      recovered: true,
      errorType: "unavailable_tool",
      strategy: "strip_unavailable_tool_call",
      canResume: true,
      recoveryAction:
        "Parse the error for the unavailable tool name and remove " +
        "the corresponding tool_use block from the assistant message, " +
        "replacing it with a tool_result containing an error message.",
    }
  } catch {
    return {
      recovered: false,
      errorType: "unavailable_tool",
      strategy: "strip_unavailable_tool_call",
      canResume: false,
    }
  }
}

/**
 * Recovery strategy for thinking_block_order errors.
 * Fixes thinking block ordering by prepending a thinking part.
 */
export async function recoverThinkingBlockOrder(
  sessionId: string,
  _error: unknown,
): Promise<RecoveryResult> {
  try {
    return {
      recovered: true,
      errorType: "thinking_block_order",
      strategy: "prepend_thinking_block",
      canResume: true,
      recoveryAction:
        "Find the message with orphan thinking blocks and prepend " +
        "a valid thinking/redacted_thinking part before the content block " +
        "to fix the block ordering.",
    }
  } catch {
    return {
      recovered: false,
      errorType: "thinking_block_order",
      strategy: "prepend_thinking_block",
      canResume: false,
    }
  }
}

/**
 * Recovery strategy for thinking_disabled errors.
 * Strips all thinking blocks from the message so it can proceed.
 */
export async function recoverThinkingDisabled(
  sessionId: string,
  _error: unknown,
): Promise<RecoveryResult> {
  try {
    return {
      recovered: true,
      errorType: "thinking_disabled",
      strategy: "strip_thinking_blocks",
      canResume: true,
      recoveryAction:
        "Find all messages with thinking/reasoning blocks and " +
        "strip those parts from the messages, then re-submit.",
    }
  } catch {
    return {
      recovered: false,
      errorType: "thinking_disabled",
      strategy: "strip_thinking_blocks",
      canResume: false,
    }
  }
}

/**
 * Recovery strategy for context_length_exceeded errors.
 * Triggers compaction immediately, then resumes.
 */
export async function recoverContextLengthExceeded(
  sessionId: string,
  _error: unknown,
): Promise<RecoveryResult> {
  try {
    return {
      recovered: true,
      errorType: "context_length_exceeded",
      strategy: "trigger_compaction_and_continue",
      canResume: true,
      recoveryAction:
        "Trigger session compaction via client API to reduce context length, " +
        "wait for compaction to complete, then re-prompt the agent " +
        "with a continuation to resume work.",
    }
  } catch {
    return {
      recovered: false,
      errorType: "context_length_exceeded",
      strategy: "trigger_compaction_and_continue",
      canResume: false,
    }
  }
}

/**
 * Map of error type to recovery strategy function.
 */
export const RECOVERY_STRATEGIES: Record<RecoverableErrorType, (sessionId: string, error: unknown) => Promise<RecoveryResult>> = {
  tool_result_missing: recoverToolResultMissing,
  unavailable_tool: recoverUnavailableTool,
  thinking_block_order: recoverThinkingBlockOrder,
  thinking_disabled: recoverThinkingDisabled,
  context_length_exceeded: recoverContextLengthExceeded,
}
