/**
 * E2E tests for Fallback and Compaction features.
 *
 * Tests model fallback chains, error retry logic, and
 * compaction checkpoint/restore lifecycle.
 */
import { describe, expect, it, beforeEach } from "bun:test"
import * as fs from "node:fs"
import {
  createMockClient,
  createTempDir,
  simulateCompacting,
  simulateSessionIdle,
  simulateEvent,
  type TempDir,
} from "./harness"
import { isRetryableError, resolveFallback, getDefaultFallbackChains } from "../../src/fallback/fallback"
import { createFallbackHook } from "../../src/fallback/hook"
import type { FallbackChain, FallbackState } from "../../src/fallback/types"
import {
  captureCheckpoint,
  restoreCheckpoint,
  clearCheckpoint,
  buildCompactionContext,
  detectNoTextTail,
} from "../../src/compaction/guard"
import type { CompactionCheckpoint } from "../../src/compaction/types"
import { createCompactionGuardHook } from "../../src/compaction/hook"

describe("Fallback E2E", () => {
  let state: FallbackState

  beforeEach(() => {
    state = { cooldowns: new Map(), failures: new Map() }
  })

  it("Retryable error triggers model fallback in chain", () => {
    // given: fallback chain [gpt-5, claude-sonnet, deepseek]
    const chain: FallbackChain = {
      provider: "openai",
      models: ["gpt-5", "claude-sonnet-4-20250514", "deepseek-v4-flash"],
      cooldownMs: 60000,
    }

    // when: session.error with 429 (rate limit)
    const error = { statusCode: 429, message: "rate limit exceeded" }
    const result = resolveFallback(error, chain, state)

    // then: resolveFallback returns next model, failed model on cooldown
    expect(result).toBe("claude-sonnet-4-20250514")
    expect(state.cooldowns.has("gpt-5")).toBe(true)
    expect(state.failures.get("gpt-5")).toBe(1)
  })

  it("Non-retryable error does NOT trigger fallback", () => {
    // given: 400 Bad Request error
    const chain: FallbackChain = {
      provider: "openai",
      models: ["gpt-5", "claude-sonnet-4-20250514"],
      cooldownMs: 60000,
    }
    const error = { statusCode: 400, message: "bad request" }

    // when: isRetryableError check
    const isRetryable = isRetryableError(error)

    // then: returns false, no fallback
    expect(isRetryable).toBe(false)

    // resolveFallback should return null for non-retryable
    const result = resolveFallback(error, chain, state)
    expect(result).toBeNull()
  })

  it("All models exhausted returns null", () => {
    // given: all models on cooldown
    const chain: FallbackChain = {
      provider: "openai",
      models: ["gpt-5", "claude-sonnet-4-20250514", "deepseek-v4-flash"],
      cooldownMs: 60000,
    }
    // Put all models on cooldown
    for (const model of chain.models) {
      state.cooldowns.set(model, Date.now() + 60000)
    }

    // when: resolveFallback called
    const error = { statusCode: 429 }
    const result = resolveFallback(error, chain, state)

    // then: returns null
    expect(result).toBeNull()
  })

  it("Cooldown expires after cooldownMs", () => {
    // given: model on cooldown
    const chain: FallbackChain = {
      provider: "openai",
      models: ["gpt-5", "claude-sonnet-4-20250514"],
      cooldownMs: 60000,
    }
    // Put model on cooldown with past timestamp (already expired)
    const past = Date.now() - 100000
    state.cooldowns.set("gpt-5", past)

    // when: resolveFallback for gpt-5 error, the fallback should be available
    const error = { statusCode: 503 }
    const result = resolveFallback(error, chain, state)

    // then: next model returned (cooldown expired doesn't block gpt-5 itself,
    // but it still tries to find a non-cooldown model for fallback)
    // gpt-5 is now failed and on extended cooldown (now + 60000),
    // but claude-sonnet has no cooldown
    expect(result).toBe("claude-sonnet-4-20250514")
  })

  it("isRetryableError matches various error patterns", () => {
    // given: various retryable errors
    expect(isRetryableError({ statusCode: 429 })).toBe(true)
    expect(isRetryableError({ statusCode: 503 })).toBe(true)
    expect(isRetryableError({ statusCode: 502 })).toBe(true)
    expect(isRetryableError({ statusCode: 504 })).toBe(true)
    expect(isRetryableError({ message: "timeout" })).toBe(true)
    expect(isRetryableError({ message: "rate limit exceeded" })).toBe(true)
    expect(isRetryableError({ message: "service unavailable" })).toBe(true)
    expect(isRetryableError({ message: "server error" })).toBe(true)
    expect(isRetryableError({ message: "overloaded" })).toBe(true)

    // non-retryable
    expect(isRetryableError({ statusCode: 400 })).toBe(false)
    expect(isRetryableError({ statusCode: 401 })).toBe(false)
    expect(isRetryableError({ statusCode: 403 })).toBe(false)
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })

  it("Fallback hook resolves fallback model", async () => {
    // given: fallback hook
    const hook = createFallbackHook({
      chains: [
        {
          provider: "openai",
          models: ["gpt-5", "claude-sonnet-4-20250514"],
          cooldownMs: 60000,
        },
      ],
    })

    // when: session.error with retryable error
    const result = await hook["session.error"]({
      sessionID: "s1",
      model: "gpt-5",
      error: { statusCode: 429 },
    })

    // then: fallback resolved
    expect(result).toBeDefined()
    expect(result!.resolved).toBe(true)
    expect(result!.fallbackModel).toBe("claude-sonnet-4-20250514")
  })

  it("Fallback hook chat.params returns resolved model", async () => {
    // given: hook with pre-resolved fallback
    const hook = createFallbackHook()
    await hook["session.error"]({
      sessionID: "s2",
      model: "anthropic/claude-sonnet-4-20250514",
      error: { statusCode: 429 },
    })

    // when: chat.params called
    const result = await hook["chat.params"]({
      sessionID: "s2",
      model: "anthropic/claude-sonnet-4-20250514",
    })

    // then: returns fallback model
    expect(result).toBeDefined()
    expect(result!.model).toBeDefined()
  })

  it("getDefaultFallbackChains returns configured chains", () => {
    // given: default chains
    const chains = getDefaultFallbackChains()

    // then: expected providers present
    expect(chains.length).toBeGreaterThan(0)
    expect(chains.some((c) => c.provider === "anthropic")).toBe(true)
    expect(chains.some((c) => c.provider === "openai")).toBe(true)
    expect(chains.some((c) => c.provider === "google")).toBe(true)
    expect(chains.some((c) => c.provider === "github-copilot")).toBe(true)

    // all have models and cooldown
    for (const chain of chains) {
      expect(chain.models.length).toBeGreaterThan(0)
      expect(chain.cooldownMs).toBeGreaterThan(0)
    }
  })
})

describe("Compaction E2E", () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = createTempDir("compaction-e2e-")
  })

  it("Captures checkpoint before compaction", () => {
    // given: agent="orchestrator", model="claude-sonnet"
    // when: captureCheckpoint called
    captureCheckpoint("session-c1", "orchestrator", "claude-sonnet-4-20250514", ["Read", "Edit", "Bash"])

    // then: checkpoint saved with agent/model/tools
    const checkpoint = restoreCheckpoint("session-c1")
    expect(checkpoint).not.toBeNull()
    expect(checkpoint!.agent).toBe("orchestrator")
    expect(checkpoint!.model).toBe("claude-sonnet-4-20250514")
    expect(checkpoint!.tools).toEqual(["Read", "Edit", "Bash"])
    expect(checkpoint!.timestamp).toBeGreaterThan(0)
  })

  it("Restores checkpoint and injects context after compaction", () => {
    // given: checkpoint was captured before compaction
    captureCheckpoint("session-c2", "orchestrator", "claude-sonnet-4-20250514", ["Read", "Edit"])
    const checkpoint = restoreCheckpoint("session-c2")
    expect(checkpoint).not.toBeNull()

    // when: buildCompactionContext called
    const todos = [
      { content: "Set up database", status: "completed", priority: "high", id: "1" },
      { content: "Create API routes", status: "in_progress", priority: "high", id: "2" },
    ]
    const context = buildCompactionContext(checkpoint!, todos)

    // then: compaction context prompt generated
    expect(context).toContain("Compaction Context (Auto-Restored)")
    expect(context).toContain("Agent: orchestrator")
    expect(context).toContain("Model: claude-sonnet-4-20250514")
    expect(context).toContain("Set up database")
    expect(context).toContain("Create API routes")
    expect(context).toContain("Remaining Tasks")
    expect(context).toContain("Work Completed")
  })

  it("clearCheckpoint removes checkpoint", () => {
    // given: checkpoint saved
    captureCheckpoint("session-c3", "agent", "model", [])

    // when: clearing
    clearCheckpoint("session-c3")

    // then: null returned
    expect(restoreCheckpoint("session-c3")).toBeNull()
  })

  it("Detects no-text-tail and triggers recovery", () => {
    // given: 5 consecutive assistant messages with no text content
    const messages = [
      { role: "assistant", parts: [{ type: "tool_use", name: "Read", id: "1" }] },
      { role: "assistant", parts: [{ type: "tool_use", name: "Edit", id: "2" }] },
      { role: "assistant", parts: [{ type: "tool_use", name: "Bash", id: "3" }] },
      { role: "assistant", parts: [{ type: "tool_use", name: "Grep", id: "4" }] },
      { role: "assistant", parts: [{ type: "tool_use", name: "Read", id: "5" }] },
    ]

    // when: detectNoTextTail
    const result = detectNoTextTail(messages)

    // then: returns true
    expect(result).toBe(true)
  })

  it("Does not detect no-text-tail for messages with text", () => {
    // given: messages with text content
    const messages = [
      { role: "assistant", parts: [{ type: "text", text: "Here is the result" }] },
      { role: "assistant", parts: [{ type: "tool_use", name: "Read" }] },
    ]

    // when: detectNoTextTail
    const result = detectNoTextTail(messages)

    // then: returns false
    expect(result).toBe(false)
  })

  it("Does not detect no-text-tail for < 5 messages", () => {
    // given: only 3 messages
    const messages = [
      { role: "assistant", parts: [{ type: "tool_use" }] },
      { role: "assistant", parts: [{ type: "tool_use" }] },
      { role: "assistant", parts: [{ type: "tool_use" }] },
    ]

    // when: detectNoTextTail
    const result = detectNoTextTail(messages)

    // then: returns false
    expect(result).toBe(false)
  })

  it("Todos preserved across compaction via hook", async () => {
    // given: hook and saved todos
    const client = createMockClient()
    const hook = createCompactionGuardHook()
    const todos = [
      { content: "Task 1", status: "in_progress", priority: "high", id: "1" },
      { content: "Task 2", status: "pending", priority: "medium", id: "2" },
      { content: "Task 3", status: "pending", priority: "low", id: "3" },
    ]

    // when: compacting event fires, then idle with same todos
    await simulateCompacting(hook["experimental.session.compacting"] as any, "session-ct1", "agent", "model")
    const idleResult = await (hook["session.idle"] as any)({
      sessionID: "session-ct1",
      todos,
    })

    // then: compaction context returned
    expect(idleResult).toBeDefined()
    expect(idleResult).toContain("Compaction Context")
    expect(idleResult).toContain("Task 1")
    expect(idleResult).toContain("Task 2")
  })

  it("Hook compaction guard detects no-text-tail recovery", async () => {
    // given: hook
    const hook = createCompactionGuardHook()
    const messages = Array.from({ length: 5 }, (_, i) => ({
      role: "assistant",
      parts: [{ type: "tool_use", name: `Tool${i}`, id: `${i}` }],
    }))

    // when: idle with no-text messages
    const result = await (hook["session.idle"] as any)({
      sessionID: "session-ct2",
      messages,
    })

    // then: recovery injection present
    expect(result).toBeDefined()
    expect(result).toContain("Recovery Injection")
    expect(result).toContain("re-state your goal")
  })
})
