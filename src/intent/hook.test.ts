import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createIntentGateHook } from "./hook"

function createMockPluginInput(): PluginInput {
  const client = {} as PluginInput["client"]
  Object.assign(client, { tui: { showToast: async () => {} } })
  return {
    client,
    project: { id: "test", worktree: "/tmp/test", time: { created: 0 } },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

describe("chat.message hook", () => {
  test('user sends "search for find and locate the auth module" → search intent injected', async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "search for find and locate the auth module" }],
    }
    await hook["chat.message"]({ sessionID: "test-1" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<system-reminder>")
    expect(textPart!.text).toContain("<search-mode>")
    expect(textPart!.text).toContain("search for find and locate the auth module")
  })

  test('user sends "implement build and create the user registration" → implement intent injected', async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "implement build and create the user registration" }],
    }
    await hook["chat.message"]({ sessionID: "test-2" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<system-reminder>")
    expect(textPart!.text).toContain("<implement-mode>")
  })

  test('user sends short message "ok" → no injection', async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "ok" }],
    }
    await hook["chat.message"]({ sessionID: "test-3" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ok")
  })

  test("short message below MIN_MESSAGE_LENGTH → no injection", async () => {
    // "fix" is 3 chars, below MIN_MESSAGE_LENGTH (10), so it's filtered before confidence check
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "fix" }],
    }
    await hook["chat.message"]({ sessionID: "test-4" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("fix")
  })

  test("confidence below threshold → no injection", async () => {
    // "hello how are you doing today" is 28 chars but has zero keyword matches → general
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "hello how are you doing today" }],
    }
    await hook["chat.message"]({ sessionID: "test-4b" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("hello how are you doing today")
  })

  test("no text part → no crash", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "tool_result", text: undefined }],
    }
    await hook["chat.message"]({ sessionID: "test-5" }, output)
    // Should not throw
  })

  test("general intent message → no injection", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "hello how are you doing today" }],
    }
    await hook["chat.message"]({ sessionID: "test-6" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("hello how are you doing today")
  })
})

describe("experimental.chat.system.transform hook", () => {
  test("appends only the detected intent optimization to system array", async () => {
    const hook = createIntentGateHook(createMockPluginInput())

    // First send a chat message to set the detected intent
    const chatOutput = {
      message: {},
      parts: [{ type: "text", text: "ultrawork: build the complete system end to end" }],
    }
    await hook["chat.message"]({ sessionID: "test" }, chatOutput)

    // Now system.transform should only append the ultrawork optimization
    const output = { system: ["existing instruction"] }
    await hook["experimental.chat.system.transform"](
      { model: { providerID: "test", modelID: "test-model" } },
      output,
    )

    expect(output.system).toContain("existing instruction")
    expect(output.system).toContain("Complete ALL work without asking for confirmation")
    expect(output.system).not.toContain("Be thorough, search multiple locations, return all findings")
    expect(output.system).not.toContain("Provide structured analysis with severity ratings")
    expect(output.system.length).toBe(2) // existing + 1 optimization
  })
})
