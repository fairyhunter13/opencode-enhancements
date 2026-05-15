import { describe, expect, test } from "bun:test"
import { createBackgroundHook } from "./hook"

describe("BackgroundHook", () => {
  describe("tool.execute.before", () => {
    test("passes through for normal tools", async () => {
      // given
      const hook = createBackgroundHook()

      // when
      const result = await hook["tool.execute.before"]({
        sessionID: "ses-1",
        tool: "read",
        args: { filePath: "/tmp/test" },
      })

      // then
      expect(result).toBeUndefined()
    })

    test("returns cancel when circuit breaker is open", async () => {
      // given
      const hook = createBackgroundHook()

      // Open the breaker by failing 3 times
      await hook["tool.execute.after"]({ sessionID: "ses-2", tool: "task", error: new Error("fail") })
      await hook["tool.execute.after"]({ sessionID: "ses-2", tool: "task", error: new Error("fail") })
      await hook["tool.execute.after"]({ sessionID: "ses-2", tool: "task", error: new Error("fail") })

      // when
      const result = await hook["tool.execute.before"]({
        sessionID: "ses-2",
        tool: "task",
        args: {},
      })

      // then
      expect(result).toEqual({ cancel: true, reason: expect.stringContaining("Circuit breaker open") })
    })

    test("detects tool-call loops and cancels", async () => {
      // given
      const hook = createBackgroundHook()
      const toolHistory = Array.from({ length: 5 }, () => ({ tool: "bash", args: { command: "ls" } }))

      // when
      const result = await hook["tool.execute.before"]({
        sessionID: "ses-3",
        tool: "bash",
        args: { command: "ls" },
        toolHistory,
      })

      // then
      expect(result).toEqual({ cancel: true, reason: expect.stringContaining("tool-call loop") })
    })
  })

  describe("tool.execute.after", () => {
    test("records success when no error", async () => {
      // given
      const hook = createBackgroundHook()

      // when — should not throw
      await hook["tool.execute.after"]({
        sessionID: "ses-4",
        tool: "bash",
      })

      // then — subsequent call should pass
      const result = await hook["tool.execute.before"]({
        sessionID: "ses-4",
        tool: "task",
        args: {},
      })
      expect(result).toBeUndefined()
    })

    test("records failure on error", async () => {
      // given
      const hook = createBackgroundHook()

      // when
      await hook["tool.execute.after"]({
        sessionID: "ses-5",
        tool: "task",
        error: new Error("rate limit"),
      })

      // then - breaker not open yet (need 3)
      const result = await hook["tool.execute.before"]({
        sessionID: "ses-5",
        tool: "task",
        args: {},
      })
      expect(result).toBeUndefined()
    })
  })
})
