/**
 * E2E tests for the Continuation feature.
 *
 * Tests the TodoContinuationEnforcer decision logic and the
 * continuation event handler hook integration.
 */
import { describe, expect, it, beforeEach, afterEach, mock, setSystemTime, useFakeTimers } from "bun:test"
import {
  createMockClient,
  createTempDir,
  simulateEvent,
  simulateSessionIdle,
  simulateSessionError,
  simulateSessionCompacted,
  simulateToolBefore,
  simulateToolAfter,
  type TempDir,
} from "./harness"
import { TodoContinuationEnforcer } from "../../src/continuation/enforcer"
import { createContinuationHook } from "../../src/continuation/hook"
import type { ContinuationState, Todo } from "../../src/continuation/types"
import {
  CONTINUATION_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_STAGNATION_COUNT,
  COMPACTION_GUARD_MS,
  IDLE_SETTLE_MS,
  SKIP_AGENTS,
} from "../../src/continuation/types"

describe("Continuation E2E", () => {
  let enforcer: TodoContinuationEnforcer
  let state: ContinuationState

  beforeEach(() => {
    enforcer = new TodoContinuationEnforcer()
    state = enforcer.resetState()
  })

  // ── Enforcer unit tests ──────────────────────────────────────────────

  it("session.idle with incomplete todos triggers continuation", async () => {
    // given: session has 2 incomplete todos
    const todos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
      { content: "Task 2", status: "pending", priority: "medium" },
    ]

    // when: checking shouldInject
    const result = enforcer.shouldInject(state, todos, "default")

    // then: continuation should be injected
    expect(result).toBe(true)
  })

  it("session.idle with all todos complete does NOT trigger", async () => {
    // given: all todos completed
    const todos: Todo[] = [
      { content: "Task 1", status: "completed", priority: "high" },
      { content: "Task 2", status: "completed", priority: "medium" },
    ]

    // when: checking shouldInject
    const result = enforcer.shouldInject(state, todos, "default")

    // then: no continuation injection
    expect(result).toBe(false)
  })

  it("Exponential backoff after repeated failures", () => {
    // given: 3 consecutive failures
    state.failures = 3
    const todos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
    ]

    // when: calculating cooldown
    const cooldown = enforcer.calculateCooldown(state.failures)
    const expected = CONTINUATION_COOLDOWN_MS * Math.pow(2, 3)

    // then: cooldown is 40000ms (5000 * 2^3)
    expect(cooldown).toBe(expected)

    // Set lastInjectionAt so that now - lastInjectionAt < cooldown
    state.lastInjectionAt = Date.now()
    const shouldInject = enforcer.shouldInject(state, todos, "default")
    expect(shouldInject).toBe(false)
  })

  it("Stagnation stops continuation after 3 no-progress injections", () => {
    // given: 3 consecutive injections with no todo progress
    state.stagnationCount = MAX_STAGNATION_COUNT
    const todos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
    ]

    // when: checking shouldInject
    const result = enforcer.shouldInject(state, todos, "default")

    // then: injection is BLOCKED (stagnation limit reached)
    expect(result).toBe(false)
  })

  it("Compaction guard prevents injection for 60s", () => {
    // given: compaction just occurred
    state.compactionGuardUntil = Date.now() + COMPACTION_GUARD_MS
    const todos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
    ]

    // when: checking shouldInject
    const result = enforcer.shouldInject(state, todos, "default")

    // then: no injection (compaction guard active)
    expect(result).toBe(false)
  })

  it("Tool activity resets stagnation counter", () => {
    // given: stagnation count at 2
    state.stagnationCount = 2

    // when: tool.execute fires (agent does work)
    enforcer.recordActivity(state)

    // then: stagnation count resets to 0
    expect(state.stagnationCount).toBe(0)
    expect(state.activitySignals).toBe(1)
  })

  it("buildContinuationPrompt includes remaining task list", () => {
    // given: mix of completed and incomplete todos
    const todos: Todo[] = [
      { content: "Done task", status: "completed", priority: "high" },
      { content: "Pending task", status: "pending", priority: "high" },
    ]

    // when: building prompt
    const prompt = enforcer.buildContinuationPrompt(todos)

    // then: prompt contains status and remaining tasks
    expect(prompt).toContain("[Status: 1/2 completed, 1 remaining]")
    expect(prompt).toContain("- [pending] Pending task")
    expect(prompt).toContain("Remaining tasks:")
  })

  it("detectStagnation detects no progress", () => {
    // given: initial state with some activity signals
    state.activitySignals = 2

    // when: detectStagnation with same or more incomplete todos
    const newTodos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
      { content: "Task 2", status: "pending", priority: "medium" },
    ]

    // then: stagnation detected (same number of incomplete = no progress)
    expect(enforcer.detectStagnation(state, newTodos)).toBe(true)
  })

  it("recordFailure increments failure count", () => {
    // given: fresh state
    expect(state.failures).toBe(0)

    // when: recording failures
    enforcer.recordFailure(state)
    enforcer.recordFailure(state)

    // then: count increases
    expect(state.failures).toBe(2)
  })

  // ── Hook integration tests ──────────────────────────────────────────

  it("Hook fires continuation prompt via promptAsync", async () => {
    // given: mock client and hook
    const client = createMockClient()
    const hook = createContinuationHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )
    const todos: Todo[] = [
      { content: "Task 1", status: "in_progress", priority: "high" },
    ]

    // when: session goes idle with incomplete todos
    await simulateSessionIdle(hook, "test-session-1", todos)

    // then: continuation prompt is injected via promptAsync
    const prompts = client.getPromptCalls()
    expect(prompts.length).toBeGreaterThan(0)
    const prompt = prompts[0]!
    expect(prompt.sessionID).toBe("test-session-1")
    expect(prompt.parts[0]?.text).toContain("TODO CONTINUATION")
  })

  it("All todos complete skips injection", async () => {
    // given: mock client and hook, all todos complete
    const client = createMockClient()
    const hook = createContinuationHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )
    const todos: Todo[] = [
      { content: "Done", status: "completed", priority: "high" },
    ]

    // when: session goes idle
    await simulateSessionIdle(hook, "test-session-2", todos)

    // then: no continuation injection
    expect(client.getPromptCalls().length).toBe(0)
  })

  it("Abort error resets stagnation and fails fast", async () => {
    // given: mock client and hook
    const client = createMockClient()
    const hook = createContinuationHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )

    // when: abort error fires
    await simulateSessionError(hook, "test-session-3", {
      name: "AbortError",
      message: "aborted",
    })

    // then: recovery timestamp set — subsequent idle within cooldown is skipped
    const todos: Todo[] = [{ content: "Task", status: "in_progress", priority: "high" }]
    await simulateSessionIdle(hook, "test-session-3", todos)

    // The first idle after abort should be skipped due to recovery cooldown
    expect(client.getPromptCalls().length).toBe(0)
  })

  it("Compaction guard set on session.compacted", async () => {
    // given: hook
    const client = createMockClient()
    const hook = createContinuationHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )

    // when: session compacted event fires
    await simulateSessionCompacted(hook, "test-session-4")

    // then: subsequent idle within guard window is blocked
    const todos: Todo[] = [{ content: "Task", status: "in_progress", priority: "high" }]
    await simulateSessionIdle(hook, "test-session-4", todos)

    expect(client.getPromptCalls().length).toBe(0)
  })

  it("Tool execute resets stagnation in hook", async () => {
    // given: hook configured
    const client = createMockClient()
    const hook = createContinuationHook(
      { client: client as any, directory: "/tmp", worktree: "/tmp" },
    )

    // Simulate tool execute events by sending tool.execute.before events
    await simulateEvent(hook, "tool.execute.before", {
      sessionID: "test-session-5",
      tool: "Read",
    })

    // Trigger idle — should work because stagnation reset
    const todos: Todo[] = [{ content: "Task", status: "in_progress", priority: "high" }]
    await simulateSessionIdle(hook, "test-session-5", todos)

    expect(client.getPromptCalls().length).toBeGreaterThan(0)
  })

  it("SKIP_AGENTS are skipped", () => {
    // given: skip agents listed
    expect(SKIP_AGENTS).toContain("compaction")
    expect(SKIP_AGENTS).toContain("plan")

    // when: session agent is in skip list
    const todos: Todo[] = [{ content: "Task", status: "in_progress", priority: "high" }]
    const result = enforcer.shouldInject(state, todos, "compaction")

    // then: injection skipped
    expect(result).toBe(false)
  })

  it("Max consecutive failures blocks injection", () => {
    // given: max failures reached
    state.failures = MAX_CONSECUTIVE_FAILURES
    const todos: Todo[] = [{ content: "Task", status: "in_progress", priority: "high" }]

    // when: checking shouldInject
    const result = enforcer.shouldInject(state, todos, "default")

    // then: blocked
    expect(result).toBe(false)
  })
})
