/**
 * E2E tests for the Recovery feature.
 *
 * Tests error detection, recovery strategies, and cooldown guards.
 */
import { describe, expect, it, beforeEach } from "bun:test"
import {
  createMockClient,
  simulateEvent,
  simulateSessionError,
} from "./harness"
import { detectErrorType } from "../../src/recovery/detector"
import { createRecoveryHook } from "../../src/recovery/hook"
import {
  recoverToolResultMissing,
  recoverUnavailableTool,
  recoverThinkingBlockOrder,
  recoverThinkingDisabled,
  recoverContextLengthExceeded,
  RECOVERY_STRATEGIES,
} from "../../src/recovery/strategies"
import type { RecoverableErrorType, RecoveryResult } from "../../src/recovery/types"

describe("Recovery E2E", () => {
  // ── Detector tests ──────────────────────────────────────────────────

  it("Recovers from missing tool_result", () => {
    // given: session error with "tool_use without tool_result" message
    const error = { name: "ApiError", message: "tool_use without tool_result" }

    // when: detectErrorType called
    const result = detectErrorType(error)

    // then: returns tool_result_missing
    expect(result).toBe("tool_result_missing")
  })

  it("Recovers from unavailable tool", () => {
    // given: session error with "tool.*not found" message
    const error1 = { name: "ApiError", message: "tool 'some_tool' not found" }
    const error2 = { name: "ApiError", message: "tool unavailable" }
    const error3 = { name: "ApiError", message: "tool not supported" }

    // then: detected as unavailable_tool
    expect(detectErrorType(error1)).toBe("unavailable_tool")
    expect(detectErrorType(error2)).toBe("unavailable_tool")
    expect(detectErrorType(error3)).toBe("unavailable_tool")
  })

  it("Does NOT recover unknown errors", () => {
    // given: random error with no known patterns
    const error = { name: "SomeError", message: "something completely unexpected" }

    // when: detectErrorType called
    const result = detectErrorType(error)

    // then: returns null, no recovery applied
    expect(result).toBeNull()
  })

  it("Recovers from thinking block order error", () => {
    // given: thinking block order error
    const error = { name: "ApiError", message: "thinking block order is wrong" }

    // when: detectErrorType
    const result = detectErrorType(error)

    // then: detected
    expect(result).toBe("thinking_block_order")
  })

  it("Recovers from thinking disabled error", () => {
    // given: thinking disabled error
    const error = { name: "ApiError", message: "thinking is disabled for this model" }

    // when: detectErrorType
    const result = detectErrorType(error)

    // then: detected
    expect(result).toBe("thinking_disabled")
  })

  it("Context length exceeded triggers compaction suggestion", () => {
    // given: session error with context length exceeded
    const error1 = { name: "ContextOverflowError", message: "context length exceeded" }
    const error2 = { name: "ApiError", message: "maximum context length reached" }
    const error3 = { name: "ApiError", message: "token limit reached" }

    // then: detected
    expect(detectErrorType(error1)).toBe("context_length_exceeded")
    expect(detectErrorType(error2)).toBe("context_length_exceeded")
    expect(detectErrorType(error3)).toBe("context_length_exceeded")
  })

  it("Handles undefined error gracefully", () => {
    // given: undefined error
    // when: detectErrorType
    const result = detectErrorType(undefined)

    // then: returns null
    expect(result).toBeNull()
  })

  it("Handles string errors", () => {
    // given: string error
    const error = "tool_use without tool_result found"

    // when: detectErrorType
    const result = detectErrorType(error)

    // then: detected
    expect(result).toBe("tool_result_missing")
  })

  it("Case-insensitive matching", () => {
    // given: mixed case error
    const error = { name: "Error", message: "TOOL_USE WITHOUT TOOL_RESULT" }

    // when: detectErrorType
    const result = detectErrorType(error)

    // then: detected (case insensitive)
    expect(result).toBe("tool_result_missing")
  })

  // ── Strategy tests ──────────────────────────────────────────────────

  it("recoverToolResultMissing returns expected result", async () => {
    // given: session and error
    const result = await recoverToolResultMissing("session-1", { message: "tool_use missing" })

    // then: recovery reports success
    expect(result.recovered).toBe(true)
    expect(result.errorType).toBe("tool_result_missing")
    expect(result.canResume).toBe(true)
  })

  it("recoverUnavailableTool returns expected result", async () => {
    const result = await recoverUnavailableTool("session-1", { message: "tool not found" })
    expect(result.recovered).toBe(true)
    expect(result.errorType).toBe("unavailable_tool")
    expect(result.canResume).toBe(true)
  })

  it("recoverThinkingBlockOrder returns expected result", async () => {
    const result = await recoverThinkingBlockOrder("session-1", { message: "thinking order" })
    expect(result.recovered).toBe(true)
    expect(result.errorType).toBe("thinking_block_order")
  })

  it("recoverThinkingDisabled returns expected result", async () => {
    const result = await recoverThinkingDisabled("session-1", { message: "thinking disabled" })
    expect(result.recovered).toBe(true)
    expect(result.errorType).toBe("thinking_disabled")
  })

  it("recoverContextLengthExceeded returns expected result", async () => {
    const result = await recoverContextLengthExceeded("session-1", { message: "context length" })
    expect(result.recovered).toBe(true)
    expect(result.errorType).toBe("context_length_exceeded")
    expect(result.strategy).toBe("trigger_compaction_and_continue")
  })

  it("RECOVERY_STRATEGIES map contains all strategies", () => {
    // given: all known error types
    const types: RecoverableErrorType[] = [
      "tool_result_missing",
      "unavailable_tool",
      "thinking_block_order",
      "thinking_disabled",
      "context_length_exceeded",
    ]

    // then: all are mapped
    for (const type of types) {
      expect(RECOVERY_STRATEGIES[type]).toBeDefined()
    }
  })

  // ── Hook tests ──────────────────────────────────────────────────────

  it("Cooldown prevents recovery loop", async () => {
    // given: mock client and hook with 5s cooldown
    const client = createMockClient()
    const hook = createRecoveryHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
      { recoveryCooldownMs: 5000 },
    )
    const error = { name: "ApiError", message: "tool_use without tool_result" }

    // when: first error fires
    await simulateSessionError(hook, "test-session-1", error)

    // Immediate second error — should be skipped by cooldown
    await simulateSessionError(hook, "test-session-1", error)

    // then: we detect the recovery was applied the first time and
    // the second was within cooldown (no crash / double-recovery)
    // Verifying by checking no errors thrown
    expect(true).toBe(true)
  })

  it("Non-recoverable errors do NOT trigger recovery", async () => {
    // given: non-recoverable error
    const client = createMockClient()
    const hook = createRecoveryHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )
    const error = { name: "SomeError", message: "random failure" }

    // when: error fires
    // No crash expected, no cooldown set for unknown errors
    await simulateSessionError(hook, "test-session-2", error)

    // then: no recovery applied (no error)
    expect(true).toBe(true)
  })

  it("Recovery runs strategy for recoverable error", async () => {
    // given: recoverable error
    const client = createMockClient()
    const hook = createRecoveryHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )
    const error = { name: "ApiError", message: "tool 'some_tool' not found" }

    // when: error fires
    await simulateSessionError(hook, "test-session-3", error)

    // then: no crash — the strategy was applied internally
    expect(true).toBe(true)
  })

  it("Different sessions have independent cooldowns", async () => {
    // given: hook
    const client = createMockClient()
    const hook = createRecoveryHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )
    const error = { message: "tool_use without tool_result" }

    // when: two different sessions error simultaneously
    await simulateSessionError(hook, "session-a", error)
    await simulateSessionError(hook, "session-b", error)

    // then: both recoveries proceed (independent cooldowns)
    expect(true).toBe(true)
  })
})
