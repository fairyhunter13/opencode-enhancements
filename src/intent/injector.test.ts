import { describe, expect, test } from "bun:test"
import { buildIntentInjection } from "./injector"
import type { IntentDetection } from "./types"

describe("buildIntentInjection", () => {
  function makeDetection(overrides: Partial<IntentDetection> = {}): IntentDetection {
    return {
      intent: "general",
      confidence: 0,
      matchedKeywords: [],
      injection: "",
      ...overrides,
    }
  }

  test("general intent returns empty string", () => {
    const result = buildIntentInjection(makeDetection())
    expect(result).toBe("")
  })

  test("zero confidence returns empty string", () => {
    const result = buildIntentInjection(makeDetection({ intent: "search", confidence: 0 }))
    expect(result).toBe("")
  })

  test("ultrawork injection contains 'Complete ALL work'", () => {
    const detection = makeDetection({
      intent: "ultrawork",
      confidence: 0.8,
      matchedKeywords: ["ultrawork"],
      injection: "<ultrawork-mode>Complete ALL work without asking for confirmation</ultrawork-mode>",
    })
    const result = buildIntentInjection(detection)
    expect(result).toContain("Complete ALL work")
  })

  test("injection wrapped in <system-reminder> tags", () => {
    const detection = makeDetection({
      intent: "search",
      confidence: 0.6,
      matchedKeywords: ["find"],
      injection: "<search-mode>some instructions</search-mode>",
    })
    const result = buildIntentInjection(detection)
    expect(result.startsWith("<system-reminder>")).toBe(true)
    expect(result.endsWith("</system-reminder>")).toBe(true)
    expect(result).toContain("<search-mode>")
  })

  test("injection includes metadata comment", () => {
    const detection = makeDetection({
      intent: "analyze",
      confidence: 0.5,
      matchedKeywords: ["analyze", "audit"],
      injection: "<analyze-mode>do analysis</analyze-mode>",
    })
    const result = buildIntentInjection(detection)
    expect(result).toContain("<!-- intent: analyze")
    expect(result).toContain("confidence: 50%")
    expect(result).toContain("matched: analyze, audit")
  })

  test("injection includes the actual mode content", () => {
    const detection = makeDetection({
      intent: "plan",
      confidence: 0.75,
      matchedKeywords: ["plan"],
      injection: "<plan-mode>plan instructions here</plan-mode>",
    })
    const result = buildIntentInjection(detection)
    expect(result).toContain("<plan-mode>")
    expect(result).toContain("plan instructions here")
  })

  test("confidence formatting shows integer percentage", () => {
    const detection = makeDetection({
      intent: "implement",
      confidence: 0.33333,
      matchedKeywords: ["fix"],
      injection: "<implement-mode>code</implement-mode>",
    })
    const result = buildIntentInjection(detection)
    expect(result).toContain("confidence: 33%")
  })

  test("injection is well-formed XML", () => {
    const detection = makeDetection({
      intent: "review",
      confidence: 0.9,
      matchedKeywords: ["review this"],
      injection: "<review-mode>check it</review-mode>",
    })
    const result = buildIntentInjection(detection)
    // Should have opening and closing system-reminder
    const openCount = (result.match(/<system-reminder>/g) ?? []).length
    const closeCount = (result.match(/<\/system-reminder>/g) ?? []).length
    expect(openCount).toBe(1)
    expect(closeCount).toBe(1)
  })
})
