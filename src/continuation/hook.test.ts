/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createContinuationHook } from "./hook"

interface PromptAsyncCall {
  path: { id: string }
  body: Record<string, unknown>
}

type MockClient = {
  session: {
    promptAsync: ReturnType<typeof mock>
    prompt?: ReturnType<typeof mock>
    todo?: ReturnType<typeof mock>
  }
  tui?: {
    showToast?: ReturnType<typeof mock>
  }
}

describe("createContinuationHook", () => {
  let promptAsyncCalls: PromptAsyncCall[]
  let mockClient: MockClient
  let mockCtx: PluginInput

  beforeEach(() => {
    promptAsyncCalls = []

    mockClient = {
      session: {
        promptAsync: mock(async (opts: PromptAsyncCall) => {
          promptAsyncCalls.push(opts)
          return {}
        }),
      },
    }

    mockCtx = {
      client: mockClient as unknown as PluginInput["client"],
      directory: "/tmp/test",
    } as PluginInput
  })

  afterEach(() => {
    mock.restore()
  })

  it("session.idle with incomplete todos → session.promptAsync called with continuation message", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-1"

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then
    expect(promptAsyncCalls.length).toBe(1)
    expect(promptAsyncCalls[0].path.id).toBe(sessionId)
    const parts = promptAsyncCalls[0].body.parts as Array<{ type: string; text: string }>
    expect(parts[0].text).toContain("TODO CONTINUATION")
  })

  it("session.idle with complete todos → session.promptAsync NOT called", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-2"

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Done", status: "completed", priority: "high" },
          ],
        },
      },
    })

    // then
    expect(promptAsyncCalls.length).toBe(0)
  })

  it("session.error with abort → enforcer records activity, does not inject immediately", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-3"

    // when — abort error fires
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID: sessionId,
          error: { name: "MessageAbortedError" },
        },
      },
    })

    // when — idle fires immediately after (within cooldown)
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then — no injection because abort marks lastInjectionAt
    expect(promptAsyncCalls.length).toBe(0)
  })

  it("tool.execute events → recorded as activity", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-4"

    // when
    await handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: sessionId },
      },
    })

    await handler({
      event: {
        type: "tool.execute.after",
        properties: { sessionID: sessionId },
      },
    })

    // then — no crash, activities recorded internally
    // We verify by injecting afterward and seeing it works
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    expect(promptAsyncCalls.length).toBe(1)
  })

  it("session.compacted arms compaction guard, blocks injection", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-5"

    // when
    await handler({
      event: {
        type: "session.compacted",
        properties: { sessionID: sessionId },
      },
    })

    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then — compaction guard blocks injection
    expect(promptAsyncCalls.length).toBe(0)
  })

  it("session.error with non-abort → does not affect injection", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-6"

    // when — non-abort error fires
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID: sessionId,
          error: { name: "NetworkError", message: "connection failed" },
        },
      },
    })

    // when — idle fires
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then — injection proceeds
    expect(promptAsyncCalls.length).toBe(1)
  })

  it("session.error with token limit error → blocks injection via stagnation", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-7"

    // when — token limit error fires
    await handler({
      event: {
        type: "session.error",
        properties: {
          sessionID: sessionId,
          error: { name: "TokenLimit", message: "context length exceeded" },
        },
      },
    })

    // when — idle fires
    await handler({
      event: {
        type: "session.idle",
        properties: {
          sessionID: sessionId,
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then — stagnation maxed, no injection
    expect(promptAsyncCalls.length).toBe(0)
  })

  it("session.idle with event carrying info.id instead of sessionID", async () => {
    // given
    const handler = createContinuationHook(mockCtx)
    const sessionId = "test-session-8"

    // when — event uses nested info.id shape
    await handler({
      event: {
        type: "session.idle",
        properties: {
          info: { id: sessionId },
          todos: [
            { id: "1", content: "Task 1", status: "pending", priority: "high" },
          ],
        },
      },
    })

    // then
    expect(promptAsyncCalls.length).toBe(1)
    expect(promptAsyncCalls[0].path.id).toBe(sessionId)
  })
})
