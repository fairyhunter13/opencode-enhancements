/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { TodoContinuationEnforcer } from "./enforcer"
import type { ContinuationState, Todo } from "./types"
import {
  CONTINUATION_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_STAGNATION_COUNT,
  COMPACTION_GUARD_MS,
  SKIP_AGENTS,
} from "./types"

function makeIncompleteTodos(count: number): Todo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    content: `Task ${i + 1}`,
    status: "pending",
    priority: "high",
  }))
}

function makeCompleteTodos(): Todo[] {
  return [{ id: "1", content: "Done", status: "completed", priority: "high" }]
}

function freshState(sessionId = "test-session"): ContinuationState {
  return {
    sessionId,
    failures: 0,
    lastInjectionAt: 0,
    stagnationCount: 0,
    compactionGuardUntil: 0,
    activitySignals: 0,
    lastActivityAt: 0,
    lastIncompleteCount: 0,
  }
}

describe("TodoContinuationEnforcer", () => {
  const enforcer = new TodoContinuationEnforcer()

  it("given incomplete todos, clean state → shouldInject = true", () => {
    // given
    const state = freshState()
    const todos = makeIncompleteTodos(2)

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(true)
  })

  it("given incomplete todos, max failures reached → shouldInject = false", () => {
    // given
    const state = freshState()
    state.failures = MAX_CONSECUTIVE_FAILURES
    const todos = makeIncompleteTodos(2)

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(false)
  })

  it("given incomplete todos, within cooldown → shouldInject = false", () => {
    // given
    const state = freshState()
    state.lastInjectionAt = Date.now() - 1000 // 1s ago, cooldown is 5s
    const todos = makeIncompleteTodos(2)

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(false)
  })

  it("given incomplete todos, stagnation count maxed → shouldInject = false", () => {
    // given
    const state = freshState()
    state.stagnationCount = MAX_STAGNATION_COUNT
    const todos = makeIncompleteTodos(2)

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(false)
  })

  it("given no incomplete todos → shouldInject = false", () => {
    // given
    const state = freshState()
    const todos = makeCompleteTodos()

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(false)
  })

  it("given compaction guard active → shouldInject = false", () => {
    // given
    const state = freshState()
    state.compactionGuardUntil = Date.now() + 100_000 // far in future
    const todos = makeIncompleteTodos(2)

    // when
    const result = enforcer.shouldInject(state, todos, "")

    // then
    expect(result).toBe(false)
  })

  for (const agent of SKIP_AGENTS) {
    it(`given agent is "${agent}" → shouldInject = false (SKIP_AGENTS)`, () => {
      // given
      const state = freshState()
      const todos = makeIncompleteTodos(2)

      // when
      const result = enforcer.shouldInject(state, todos, agent)

      // then
      expect(result).toBe(false)
    })
  }

  it("given failures=2 → cooldown = 20000ms (exponential backoff)", () => {
    // given
    const failures = 2

    // when
    const cooldown = enforcer.calculateCooldown(failures)

    // then: CONTINUATION_COOLDOWN_MS * 2^2 = 5000 * 4 = 20000
    expect(cooldown).toBe(CONTINUATION_COOLDOWN_MS * Math.pow(2, 2))
  })

  it("given new todos same as before → stagnation detected", () => {
    // given
    const state = freshState()
    state.lastIncompleteCount = 2 // previous incomplete count
    const todos = makeIncompleteTodos(2) // same count

    // when
    const stagnant = enforcer.detectStagnation(state, todos)

    // then
    expect(stagnant).toBe(true)
  })

  it("given new todos different → stagnation NOT detected", () => {
    // given
    const state = freshState()
    state.lastIncompleteCount = 5 // previous incomplete count
    const todos = makeIncompleteTodos(2) // fewer now

    // when
    const stagnant = enforcer.detectStagnation(state, todos)

    // then
    expect(stagnant).toBe(false)
  })

  it("buildContinuationPrompt includes todo status and only incomplete tasks in list", () => {
    // given
    const todos = [
      { id: "1", content: "Task A", status: "pending", priority: "high" },
      { id: "2", content: "Task B", status: "completed", priority: "medium" },
    ]

    // when
    const prompt = enforcer.buildContinuationPrompt(todos)

    // then
    expect(prompt).toContain("TODO CONTINUATION")
    expect(prompt).toContain("Task A")
    expect(prompt).not.toContain("Task B") // completed tasks omitted from list
    expect(prompt).toContain("[Status: 1/2 completed, 1 remaining]")
  })

  it("recordActivity resets stagnation and increments signal", () => {
    // given
    const state = freshState()
    state.stagnationCount = 3
    state.activitySignals = 0

    // when
    enforcer.recordActivity(state)

    // then
    expect(state.stagnationCount).toBe(0)
    expect(state.activitySignals).toBe(1)
  })

  it("recordFailure increments failures", () => {
    // given
    const state = freshState()

    // when
    enforcer.recordFailure(state)
    enforcer.recordFailure(state)

    // then
    expect(state.failures).toBe(2)
  })

  it("resetState returns fresh state", () => {
    // when
    const state = enforcer.resetState()

    // then
    expect(state.failures).toBe(0)
    expect(state.lastInjectionAt).toBe(0)
    expect(state.stagnationCount).toBe(0)
    expect(state.compactionGuardUntil).toBe(0)
    expect(state.activitySignals).toBe(0)
  })
})
