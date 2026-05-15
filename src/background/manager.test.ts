import { describe, expect, test, beforeEach, afterEach, mock, jest } from "bun:test"
import { ConcurrencyManager, CircuitBreaker, waitForStable, detectToolCallLoop } from "./manager"

describe("ConcurrencyManager", () => {
  let manager: ConcurrencyManager

  beforeEach(() => {
    manager = new ConcurrencyManager(2)
  })

  test("runs task immediately when under limit", async () => {
    // given
    let ran = false

    // when
    manager.enqueue("key-a", async () => { ran = true })

    // then
    expect(ran).toBe(true)
    expect(manager.getActiveCount("key-a")).toBe(1)
  })

  test("queues task when at limit", async () => {
    // given
    const results: number[] = []
    const neverResolve = new Promise<void>(() => {})

    // when
    manager.enqueue("key-b", async () => { results.push(1); await neverResolve })
    manager.enqueue("key-b", async () => { results.push(2); await neverResolve })
    manager.enqueue("key-b", async () => { results.push(3); await neverResolve })

    // then
    expect(results).toEqual([1, 2]) // first 2 run immediately
    expect(manager.getQueueLength("key-b")).toBe(1)
  })

  test("dequeue runs next queued task when active completes", async () => {
    // given
    const manager = new ConcurrencyManager(1) // limit 1 ensures queuing
    const results: number[] = []
    let resolveFirst!: () => void
    const first = new Promise<void>((r) => { resolveFirst = r })

    manager.enqueue("key-c", async () => { results.push(1); await first })
    manager.enqueue("key-c", async () => { results.push(2) })

    // First runs immediately, second is queued
    expect(results).toEqual([1])
    expect(manager.getQueueLength("key-c")).toBe(1)

    // when
    resolveFirst()
    await new Promise((r) => setTimeout(r, 10))

    // then
    expect(results).toEqual([1, 2])
    expect(manager.getQueueLength("key-c")).toBe(0)
  })

  test("getActiveCount returns 0 for unknown key", () => {
    // given / when / then
    expect(manager.getActiveCount("unknown")).toBe(0)
  })

  test("getQueueLength returns 0 for unknown key", () => {
    // given / when / then
    expect(manager.getQueueLength("unknown")).toBe(0)
  })

  test("maxPerKey reflects constructor value", () => {
    // given
    const m = new ConcurrencyManager(10)

    // when / then
    expect(m.maxPerKey).toBe(10)
  })
})

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker

  beforeEach(() => {
    cb = new CircuitBreaker(10000)
  })

  test("starts closed and allows requests", () => {
    // given / when / then
    expect(cb.checkCircuit("key-a")).toBe(true)
    expect(cb.isOpen("key-a")).toBe(false)
  })

  test("opens after 3 consecutive failures", () => {
    // given / when
    cb.recordFailure("key-b")
    cb.recordFailure("key-b")
    cb.recordFailure("key-b")

    // then
    expect(cb.isOpen("key-b")).toBe(true)
    expect(cb.checkCircuit("key-b")).toBe(false)
  })

  test("does not open before 3 failures", () => {
    // given / when
    cb.recordFailure("key-c")
    cb.recordFailure("key-c")

    // then
    expect(cb.isOpen("key-c")).toBe(false)
    expect(cb.checkCircuit("key-c")).toBe(true)
  })

  test("auto-resets after resetAfterMs", async () => {
    // given
    const cb = new CircuitBreaker(50)
    cb.recordFailure("key-d")
    cb.recordFailure("key-d")
    cb.recordFailure("key-d")
    expect(cb.isOpen("key-d")).toBe(true)

    // when
    await new Promise((r) => setTimeout(r, 60))

    // then
    expect(cb.checkCircuit("key-d")).toBe(true)
    expect(cb.isOpen("key-d")).toBe(false)
  })

  test("recordSuccess resets the breaker", () => {
    // given
    cb.recordFailure("key-e")
    cb.recordFailure("key-e")
    cb.recordFailure("key-e")
    expect(cb.isOpen("key-e")).toBe(true)

    // when
    cb.recordSuccess("key-e")

    // then
    expect(cb.isOpen("key-e")).toBe(false)
    expect(cb.checkCircuit("key-e")).toBe(true)
  })

  test("reset clears state", () => {
    // given
    cb.recordFailure("key-f")
    cb.reset("key-f")

    // when / then
    expect(cb.isOpen("key-f")).toBe(false)
    expect(cb.checkCircuit("key-f")).toBe(true)
  })
})

describe("detectToolCallLoop", () => {
  test("returns isLoop when 5+ identical consecutive tool calls", () => {
    // given
    const history = Array.from({ length: 5 }, () => ({ tool: "bash", args: { command: "echo hello" } }))

    // when
    const result = detectToolCallLoop(history)

    // then
    expect(result.isLoop).toBe(true)
    expect(result.tool).toBe("bash")
    expect(result.count).toBe(5)
  })

  test("returns not loop for fewer than 5 calls", () => {
    // given
    const history = Array.from({ length: 3 }, () => ({ tool: "bash", args: { command: "echo hi" } }))

    // when
    const result = detectToolCallLoop(history)

    // then
    expect(result.isLoop).toBe(false)
  })

  test("returns not loop when tools differ", () => {
    // given
    const history = [
      { tool: "bash", args: { command: "echo 1" } },
      { tool: "read", args: { filePath: "/tmp/test" } },
      { tool: "bash", args: { command: "echo 2" } },
      { tool: "edit", args: { filePath: "/tmp/test" } },
      { tool: "bash", args: { command: "echo 3" } },
    ]

    // when
    const result = detectToolCallLoop(history)

    // then
    expect(result.isLoop).toBe(false)
  })

  test("returns not loop for empty history", () => {
    // given / when
    const result = detectToolCallLoop([])

    // then
    expect(result.isLoop).toBe(false)
  })

  test("returns not loop when args differ", () => {
    // given
    const history = [
      { tool: "read", args: { filePath: "/tmp/a" } },
      { tool: "read", args: { filePath: "/tmp/b" } },
      { tool: "read", args: { filePath: "/tmp/c" } },
      { tool: "read", args: { filePath: "/tmp/d" } },
      { tool: "read", args: { filePath: "/tmp/e" } },
    ]

    // when
    const result = detectToolCallLoop(history)

    // then
    expect(result.isLoop).toBe(false)
  })
})
