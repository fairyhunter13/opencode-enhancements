import { describe, expect, test } from "bun:test"
import { detectIntent, normalizeMessage } from "./detector"
import type { IntentDetection } from "./types"

describe("normalizeMessage", () => {
  test("lowercases and strips punctuation", () => {
    expect(normalizeMessage("Hello, World!")).toBe("hello world")
  })

  test("collapses whitespace", () => {
    expect(normalizeMessage("  search   for   this  ")).toBe("search for this")
  })

  test("returns empty string for empty input", () => {
    expect(normalizeMessage("")).toBe("")
  })
})

describe("detectIntent", () => {
  function assertIntent(message: string, expected: string, opts?: { confidence?: number; keywords?: string[] }) {
    const result = detectIntent(message)
    expect(result.intent).toBe(expected)
    if (opts?.confidence !== undefined) {
      expect(result.confidence).toBeGreaterThanOrEqual(opts.confidence - 0.001)
      expect(result.confidence).toBeLessThanOrEqual(opts.confidence + 0.001)
    }
    if (opts?.keywords !== undefined) {
      expect(result.matchedKeywords.sort()).toEqual([...opts.keywords].sort())
    }
  }

  test('detects ultrawork: "ultrawork: build the entire authentication system"', () => {
    assertIntent("ultrawork: build the entire authentication system", "ultrawork", {
      keywords: ["ultrawork"],
    })
  })

  test('detects ultrawork: "deep work: implement the new feature"', () => {
    assertIntent("deep work: implement the new feature", "ultrawork", {
      keywords: ["deep work"],
    })
  })

  test('detects search: "where is the login handler"', () => {
    assertIntent("where is the login handler", "search", {
      keywords: ["where is"],
    })
  })

  test('detects search: "find the auth module"', () => {
    assertIntent("find the auth module", "search", {
      keywords: ["find"],
    })
  })

  test('detects search: "look up the user model"', () => {
    assertIntent("look up the user model", "search", {
      keywords: ["look up"],
    })
  })

  test('detects analyze: "analyze the performance of the query"', () => {
    assertIntent("analyze the performance of the query", "analyze", {
      keywords: ["analyze"],
    })
  })

  test('detects analyze: "evaluate the algorithm complexity"', () => {
    assertIntent("evaluate the algorithm complexity", "analyze", {
      keywords: ["evaluate"],
    })
  })

  test('detects analyze: "audit the security of the API"', () => {
    assertIntent("audit the security of the API", "analyze", {
      keywords: ["audit"],
    })
  })

  test('detects plan: "plan the database migration"', () => {
    assertIntent("plan the database migration", "plan", {
      keywords: ["plan"],
    })
  })

  test('detects plan: "how should I structure the module"', () => {
    assertIntent("how should I structure the module", "plan", {
      keywords: ["how should i"],
    })
  })

  test('detects implement: "implement the user registration endpoint"', () => {
    assertIntent("implement the user registration endpoint", "implement", {
      keywords: ["implement"],
    })
  })

  test('detects implement: "fix the broken login flow"', () => {
    assertIntent("fix the broken login flow", "implement", {
      keywords: ["fix"],
    })
  })

  test('detects implement: "refactor the authentication service"', () => {
    assertIntent("refactor the authentication service", "implement", {
      keywords: ["refactor"],
    })
  })

  test('detects review: "review this pull request"', () => {
    assertIntent("review this pull request", "review", {
      keywords: ["review", "review this"],
    })
  })

  test('detects review: "check my implementation"', () => {
    assertIntent("check my implementation", "review", {
      keywords: ["check my"],
    })
  })

  test('detects review: "verify the error handling"', () => {
    assertIntent("verify the error handling", "review", {
      keywords: ["verify"],
    })
  })

  test('falls back to general for "hello"', () => {
    assertIntent("hello", "general", { confidence: 0 })
  })

  test("falls back to general for empty message", () => {
    assertIntent("", "general", { confidence: 0 })
  })

  test("falls back to general for whitespace-only message", () => {
    assertIntent("   ", "general", { confidence: 0 })
  })

  test("multiple keyword matches: highest priority wins", () => {
    // "ultrawork implement" has both ultrawork (priority 100) and implement (priority 70)
    const result = detectIntent("ultrawork implement the feature")
    // ultrawork should win due to higher priority
    expect(result.intent).toBe("ultrawork")
    expect(result.matchedKeywords).toContain("ultrawork")
  })

  test("confidence calculation is correct", () => {
    // "fix" matches 1 of 7 implement keywords → 1/7 ≈ 0.143 confidence
    const result = detectIntent("fix the bug")
    expect(result.intent).toBe("implement")
    expect(result.confidence).toBeCloseTo(1 / 7, 5)
    expect(result.matchedKeywords).toEqual(["fix"])
  })

  test("multiple matched keywords increase confidence", () => {
    // "plan blueprint" matches 2 of 7 plan keywords → 2/7 confidence
    const result = detectIntent("plan blueprint the new system")
    expect(result.intent).toBe("plan")
    expect(result.confidence).toBeCloseTo(2 / 7, 5)
    expect(result.matchedKeywords.sort()).toEqual(["blueprint", "plan"].sort())
  })

  test("returns injection string for matched intent", () => {
    const result = detectIntent("find the bug")
    expect(result.intent).toBe("search")
    expect(result.injection).toBeTruthy()
    expect(result.injection).toContain("<search-mode>")
  })

  test("returns empty injection for general intent", () => {
    const result = detectIntent("hello there")
    expect(result.intent).toBe("general")
    expect(result.injection).toBe("")
  })

  test("detects intent with custom rules", () => {
    const customRules = [
      {
        intent: "custom" as const,
        priority: 50,
        keywords: ["foobar", "bazqux"],
        injection: "<custom>injection</custom>",
      },
    ]
    const result = detectIntent("use the foobar utility", customRules)
    expect(result.intent).toBe("custom")
    expect(result.matchedKeywords).toEqual(["foobar"])
  })

  test("multi-word keyword with phrase match", () => {
    const result = detectIntent("I need an end to end solution for auth")
    expect(result.intent).toBe("ultrawork")
    expect(result.matchedKeywords).toContain("end to end")
  })
})
