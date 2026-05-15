import { describe, expect, test } from "bun:test"
import { createCompactionGuardHook } from "./hook"

describe("CompactionGuardHook", () => {
  describe("experimental.session.compacting", () => {
    test("captures checkpoint when agent and model provided", async () => {
      // given
      const hook = createCompactionGuardHook()

      // when
      await hook["experimental.session.compacting"]({
        sessionID: "ses-1",
        agent: "atlas",
        model: "claude-sonnet-4",
        tools: ["bash", "edit"],
      })

      // then — session.idle should produce context
      const result = await hook["session.idle"]({
        sessionID: "ses-1",
        todos: [{ content: "Task A", status: "pending", priority: "high", id: "1" }],
      })

      expect(result).toContain("Compaction Context")
      expect(result).toContain("atlas")
      expect(result).toContain("claude-sonnet-4")
      expect(result).toContain("Task A")
    })

    test("does nothing when agent is missing", async () => {
      // given
      const hook = createCompactionGuardHook()

      // when
      await hook["experimental.session.compacting"]({
        sessionID: "ses-2",
      })

      const result = await hook["session.idle"]({
        sessionID: "ses-2",
        todos: [],
      })

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("session.idle", () => {
    test("detects no-text-tail and returns recovery injection", async () => {
      // given
      const hook = createCompactionGuardHook()
      const messages = Array.from({ length: 5 }, () => ({
        role: "assistant",
        parts: [{ type: "tool_use", id: "call_1" }],
      }))

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-3",
        messages,
      })

      // then
      expect(result).toContain("Recovery Injection")
      expect(result).toContain("repeated assistant messages without text")
    })

    test("does not inject recovery when messages have text", async () => {
      // given
      const hook = createCompactionGuardHook()
      const messages = Array.from({ length: 5 }, () => ({
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
      }))

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-4",
        messages,
      })

      // then
      expect(result).toBeUndefined()
    })

    test("returns context when session was compacted", async () => {
      // given
      const hook = createCompactionGuardHook()
      await hook["experimental.session.compacting"]({
        sessionID: "ses-5",
        agent: "coder",
        model: "gpt-4o",
      })

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-5",
        todos: [{ content: "Fix bug", status: "pending", priority: "high", id: "1" }],
      })

      // then
      expect(result).toContain("Compaction Context")
      expect(result).toContain("coder")
      expect(result).toContain("Fix bug")
    })

    test("returns undefined for unknown session without no-text-tail", async () => {
      // given
      const hook = createCompactionGuardHook()

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-6",
      })

      // then
      expect(result).toBeUndefined()
    })
  })

  describe("tool.execute.before", () => {
    test("does not block todowrite tool", async () => {
      // given
      const hook = createCompactionGuardHook()

      // when
      const result = await hook["tool.execute.before"]({
        tool: "todowrite",
        args: { todos: [{ content: "test", status: "pending", priority: "high", id: "1" }] },
      })

      // then
      expect(result).toBeUndefined()
    })
  })
})
