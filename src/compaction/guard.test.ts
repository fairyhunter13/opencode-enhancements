import { describe, expect, test, beforeEach } from "bun:test"
import {
  captureCheckpoint,
  restoreCheckpoint,
  clearCheckpoint,
  buildCompactionContext,
  detectNoTextTail,
} from "./guard"
import type { CompactionCheckpoint } from "./types"

describe("captureCheckpoint / restoreCheckpoint", () => {
  beforeEach(() => {
    clearCheckpoint("ses-test")
  })

  test("captures and restores a checkpoint", () => {
    // given
    captureCheckpoint("ses-test", "atlas", "anthropic/claude-sonnet-4", ["bash", "edit", "read"])

    // when
    const restored = restoreCheckpoint("ses-test")

    // then
    expect(restored).not.toBeNull()
    expect(restored!.agent).toBe("atlas")
    expect(restored!.model).toBe("anthropic/claude-sonnet-4")
    expect(restored!.tools).toEqual(["bash", "edit", "read"])
    expect(restored!.timestamp).toBeGreaterThan(0)
  })

  test("returns null for unknown session", () => {
    // given / when
    const restored = restoreCheckpoint("ses-unknown")

    // then
    expect(restored).toBeNull()
  })

  test("clearing checkpoint makes restore return null", () => {
    // given
    captureCheckpoint("ses-test", "agent-x", "model-y", ["tool-z"])

    // when
    clearCheckpoint("ses-test")
    const restored = restoreCheckpoint("ses-test")

    // then
    expect(restored).toBeNull()
  })

  test("capture overwrites previous checkpoint for same session", () => {
    // given
    captureCheckpoint("ses-test", "agent-old", "model-old", ["tool-a"])

    // when
    captureCheckpoint("ses-test", "agent-new", "model-new", ["tool-b"])
    const restored = restoreCheckpoint("ses-test")

    // then
    expect(restored!.agent).toBe("agent-new")
    expect(restored!.model).toBe("model-new")
  })
})

describe("buildCompactionContext", () => {
  test("builds context with completed and remaining todos", () => {
    // given
    const checkpoint: CompactionCheckpoint = {
      agent: "atlas",
      model: "claude-sonnet-4",
      tools: ["bash", "edit"],
      timestamp: Date.now(),
    }
    const todos = [
      { content: "Setup database", status: "completed", priority: "high", id: "1" },
      { content: "Create API endpoint", status: "completed", priority: "high", id: "2" },
      { content: "Add tests", status: "pending", priority: "medium", id: "3" },
      { content: "Deploy to staging", status: "pending", priority: "low", id: "4" },
    ]

    // when
    const context = buildCompactionContext(checkpoint, todos)

    // then
    expect(context).toContain("Compaction Context")
    expect(context).toContain("atlas")
    expect(context).toContain("claude-sonnet-4")
    expect(context).toContain("Setup database")
    expect(context).toContain("Create API endpoint")
    expect(context).toContain("Add tests")
    expect(context).toContain("Deploy to staging")
    expect(context).toContain("Work Completed")
    expect(context).toContain("Remaining Tasks")
  })

  test("includes agent, model, tools in context", () => {
    // given
    const checkpoint: CompactionCheckpoint = {
      agent: "explorer",
      model: "gpt-4o",
      tools: ["read", "grep", "glob"],
      timestamp: 1000,
    }

    // when
    const context = buildCompactionContext(checkpoint, [])

    // then
    expect(context).toContain("explorer")
    expect(context).toContain("gpt-4o")
    expect(context).toContain("read, grep, glob")
  })

  test("omits completed section when no completed todos", () => {
    // given
    const checkpoint: CompactionCheckpoint = {
      agent: "a", model: "m", tools: [], timestamp: 0,
    }

    // when
    const context = buildCompactionContext(checkpoint, [
      { content: "One", status: "pending", priority: "high", id: "1" },
    ])

    // then
    expect(context).not.toContain("Work Completed")
    expect(context).toContain("Remaining Tasks")
  })
})

describe("detectNoTextTail", () => {
  function makeAssistant(hasText: boolean, parts?: any[]) {
    return {
      role: "assistant",
      parts: parts ?? (hasText ? [{ type: "text", text: "hello" }] : [{ type: "tool_use", id: "call_1" }]),
    }
  }

  test("returns true when 5+ consecutive assistant messages have no text", () => {
    // given
    const messages = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
    ]

    // when
    const result = detectNoTextTail(messages)

    // then
    expect(result).toBe(true)
  })

  test("returns false when assistant message has text", () => {
    // given
    const messages = [
      makeAssistant(true),
      makeAssistant(true),
      makeAssistant(true),
      makeAssistant(true),
      makeAssistant(true),
    ]

    // when
    const result = detectNoTextTail(messages)

    // then
    expect(result).toBe(false)
  })

  test("returns false for fewer than 5 messages", () => {
    // given
    const messages = [makeAssistant(false), makeAssistant(false), makeAssistant(false)]

    // when
    const result = detectNoTextTail(messages)

    // then
    expect(result).toBe(false)
  })

  test("stops counting at user message", () => {
    // given — 5 assistant messages after user, but user message breaks the chain
    const messages = [
      { role: "user", parts: [{ type: "text", text: "do this" }] },
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
      makeAssistant(false),
    ]

    // when — include user message, so only 5 assistants after it (count resets at user)
    const result = detectNoTextTail(messages)

    // then — user message resets count, still 5 assistants after = detected
    expect(result).toBe(true)
  })

  test("returns false for empty messages", () => {
    // given / when
    const result = detectNoTextTail([])

    // then
    expect(result).toBe(false)
  })
})
