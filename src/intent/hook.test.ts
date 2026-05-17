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

describe("deduplication: no self-triggering from injected system-reminder keywords", () => {
  test("text containing only system-reminder keywords from previous injection → no injection", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    // Simulate a message where the only "search" keywords come from a
    // previous injection's own text (e.g. "grep", "glob", "search").
    // After stripping <system-reminder> blocks, only the user text remains.
    const previousInjection = `<system-reminder>
<!-- intent: search | confidence: 57% | matched: search for, find, grep, glob -->
<search-mode>
You are in SEARCH mode. This means:
- Use codebase_search, Grep, and Glob tools exhaustively
</search-mode>
</system-reminder>`
    const userText = "can you explain what happened"
    const output = {
      message: {},
      parts: [{ type: "text", text: `${previousInjection}\n\n${userText}` }],
    }
    await hook["chat.message"]({ sessionID: "dedup-1" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    // Should NOT inject because after stripping system-reminders,
    // the remaining "can you explain what happened" has no search keywords
    expect(textPart!.text).toBe(`${previousInjection}\n\n${userText}`)
  })

  test("text with previous injection + new search keywords → single new injection added", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    // User's actual text contains "search for" and "find", so detection
    // should fire. But only ONE NEW injection should be added (not stacked).
    // The old injection is preserved in the userText portion.
    const previousInjection = `<system-reminder>
<!-- intent: search | confidence: 57% | matched: search for, find, grep, glob -->
<search-mode>
You are in SEARCH mode.
</search-mode>
</system-reminder>`
    const userText = "search for the configuration file and find where it is loaded"
    const output = {
      message: {},
      parts: [{ type: "text", text: `${previousInjection}\n\n${userText}` }],
    }
    await hook["chat.message"]({ sessionID: "dedup-2" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<system-reminder>")
    expect(textPart!.text).toContain("<search-mode>")
    expect(textPart!.text).toContain(userText)
    // The text must NOT have 3+ <system-reminder> tags (no stacking/feedback loop).
    // It may have 1 (if the old one was in userText before being overwritten)
    // or up to 2 (old preserved + new). But never 3+.
    const openCount = (textPart!.text.match(/<system-reminder>/g) ?? []).length
    const closeCount = (textPart!.text.match(/<\/system-reminder>/g) ?? []).length
    expect(openCount).toBeLessThanOrEqual(2)
    expect(closeCount).toBeLessThanOrEqual(2)
    expect(openCount).toBe(closeCount)
  })

  test("text consisting entirely of a system-reminder block → no injection", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    // If the entire message is just a system-reminder (edge case),
    // stripping leaves empty string — should not inject.
    const onlyInjection = `<system-reminder>
<!-- intent: search | confidence: 57% | matched: search for, find, grep, glob -->
<search-mode>
You are in SEARCH mode.
</search-mode>
</system-reminder>`
    const output = {
      message: {},
      parts: [{ type: "text", text: onlyInjection }],
    }
    await hook["chat.message"]({ sessionID: "dedup-3" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe(onlyInjection)
  })

  test("no false negative: plain text with search keywords still gets injection", async () => {
    const hook = createIntentGateHook(createMockPluginInput())
    const output = {
      message: {},
      parts: [{ type: "text", text: "use grep and glob to search for the code" }],
    }
    await hook["chat.message"]({ sessionID: "dedup-4" }, output)

    const textPart = output.parts.find((p) => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<system-reminder>")
    expect(textPart!.text).toContain("<search-mode>")
    // Only one system-reminder
    const openCount = (textPart!.text.match(/<system-reminder>/g) ?? []).length
    expect(openCount).toBe(1)
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
