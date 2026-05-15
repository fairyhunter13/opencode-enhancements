/**
 * E2E tests for the IntentGate feature.
 *
 * Tests intent detection from user messages and system prompt injection.
 */
import { describe, expect, it } from "bun:test"
import {
  createMockClient,
  simulateChatMessage,
  simulateSystemTransform,
} from "./harness"
import { detectIntent, normalizeMessage } from "../../src/intent/detector"
import { buildIntentInjection } from "../../src/intent/injector"
import { createIntentGateHook } from "../../src/intent/hook"
import { DEFAULT_KEYWORD_RULES } from "../../src/intent/keywords"
import type { IntentDetection } from "../../src/intent/types"

describe("IntentGate E2E", () => {
  // ── Detector tests ──────────────────────────────────────────────────

  it("Detects ultrawork intent from keywords", () => {
    // given: user message with ultrawork keyword
    const message = "ultrawork: build the complete auth system"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: ultrawork intent detected
    expect(result.intent).toBe("ultrawork")
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.matchedKeywords).toContain("ultrawork")
    expect(result.injection).toContain("ULTRAWORK mode")
  })

  it("Detects search intent", () => {
    // given: user message with search keywords
    const message = "where is the authentication middleware"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: search intent detected
    expect(result.intent).toBe("search")
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.matchedKeywords.length).toBeGreaterThan(0)
    expect(result.injection).toContain("SEARCH mode")
  })

  it("Detects analyze intent", () => {
    // given: analyze keywords
    const message = "analyze the security of this code"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: analyze intent
    expect(result.intent).toBe("analyze")
    expect(result.injection).toContain("ANALYZE mode")
  })

  it("Detects plan intent", () => {
    // given: plan keywords
    const message = "plan the architecture for the payment system"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: plan intent
    expect(result.intent).toBe("plan")
    expect(result.injection).toContain("PLAN mode")
  })

  it("Detects implement intent", () => {
    // given: implement keywords
    const message = "implement the user registration feature"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: implement intent
    expect(result.intent).toBe("implement")
    expect(result.injection).toContain("IMPLEMENT mode")
  })

  it("Detects review intent", () => {
    // given: review keywords
    const message = "review this pull request for issues"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: review intent
    expect(result.intent).toBe("review")
    expect(result.injection).toContain("REVIEW mode")
  })

  it("Falls back to general for ambiguous messages", () => {
    // given: user message with no keywords
    const message = "hello"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: general intent, no injection
    expect(result.intent).toBe("general")
    expect(result.confidence).toBe(0)
    expect(result.injection).toBe("")
  })

  it("Short messages are skipped by hook", async () => {
    // given: mock client and hook
    const client = createMockClient()
    const hooks = createIntentGateHook({
      client: client as any,
      directory: "/tmp",
      worktree: "/tmp",
    })
    const chatMessageHook = hooks["chat.message"]
    expect(chatMessageHook).toBeDefined()

    // when: short message "ok" sent
    const output = {
      message: { id: "m1", role: "user" } as Record<string, unknown>,
      parts: [{ type: "text" as const, text: "ok" }],
    }
    await chatMessageHook!(
      { sessionID: "s1", messageID: "m1", variant: "default" },
      output as any,
    )

    // then: no intent injection (too short)
    expect(output.parts[0]?.text).toBe("ok")
  })

  it("Confidence threshold filters weak matches", () => {
    // given: message with only weak keyword match
    // A single low-weight keyword provides low confidence
    const message = "build a thing"

    // when: detectIntent called
    const result = detectIntent(message, DEFAULT_KEYWORD_RULES)

    // then: still matches implement (1/7 ≈ 0.14 is below MIN_CONFIDENCE of 0.3,
    // but detectIntent itself doesn't filter by threshold — the hook does)
    // The detector returns whatever it finds regardless of confidence
    expect(result.intent).toBe("implement")
    expect(result.confidence).toBeGreaterThanOrEqual(0.1)
  })

  it("system.transform receives intent optimizations after chat.message", async () => {
    // given: hooks
    const client = createMockClient()
    const hooks = createIntentGateHook({
      client: client as any,
      directory: "/tmp",
      worktree: "/tmp",
    })
    const transformHook = hooks["experimental.chat.system.transform"]
    expect(transformHook).toBeDefined()

    // First send a chat message to set the detected intent
    const chatHook = hooks["chat.message"]
    const chatOutput = {
      message: { id: "m1", role: "user" } as Record<string, unknown>,
      parts: [{ type: "text" as const, text: "ultrawork: build the complete system end to end" }],
    }
    await chatHook!(
      { sessionID: "s1", messageID: "m1", variant: "default" },
      chatOutput as any,
    )

    // when: system.transform hook fires
    const system: string[] = []
    const output = { system }
    await transformHook!(
      { model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
      output as any,
    )

    // then: only ultrawork optimization appended
    expect(output.system).toContain("Complete ALL work without asking for confirmation")
    expect(output.system).not.toContain("Be thorough, search multiple locations, return all findings")
  })

  it("buildIntentInjection returns empty for general intent", () => {
    // given: general detection
    const detection: IntentDetection = {
      intent: "general",
      confidence: 0,
      matchedKeywords: [],
      injection: "",
    }

    // when: building injection
    const result = buildIntentInjection(detection)

    // then: empty string
    expect(result).toBe("")
  })

  it("buildIntentInjection builds proper system-reminder for non-general", () => {
    // given: ultrawork detection
    const detection: IntentDetection = {
      intent: "ultrawork",
      confidence: 0.8,
      matchedKeywords: ["ultrawork"],
      injection: "<ultrawork-mode>work</ultrawork-mode>",
    }

    // when: building injection
    const result = buildIntentInjection(detection)

    // then: includes system-reminder tags with metadata
    expect(result).toContain("<system-reminder>")
    expect(result).toContain("</system-reminder>")
    expect(result).toContain("intent: ultrawork")
    expect(result).toContain("confidence: 80%")
    expect(result).toContain("<ultrawork-mode>")
  })

  it("normalizeMessage lowercases and removes punctuation", () => {
    // given: message with punctuation
    const message = "WHERE IS the auth?!"

    // when: normalizeMessage called
    const result = normalizeMessage(message)

    // then: cleaned string
    expect(result).toBe("where is the auth")
  })

  it("Chat message hook injects ultrawork mode into message", async () => {
    // given: hook configured
    const client = createMockClient()
    const hooks = createIntentGateHook({
      client: client as any,
      directory: "/tmp",
      worktree: "/tmp",
    })
    const chatMessageHook = hooks["chat.message"]
    expect(chatMessageHook).toBeDefined()

    // when: ultrawork message sent (multiple keywords for >= 0.3 confidence)
    // "build everything" + "complete feature" + "ultrawork" = 3/6 = 0.5 confidence
    const output = {
      message: { id: "m1", role: "user" } as Record<string, unknown>,
      parts: [{ type: "text" as const, text: "ultrawork: build everything complete feature" }],
    }
    await chatMessageHook!(
      { sessionID: "s1", messageID: "m1", variant: "default" },
      output as any,
    )

    // then: system-reminder injected before the message
    expect(output.parts[0]?.text).toContain("<system-reminder>")
    expect(output.parts[0]?.text).toContain("</system-reminder>")
    expect(output.parts[0]?.text).toContain("ultrawork: build everything complete feature")
  })
})
