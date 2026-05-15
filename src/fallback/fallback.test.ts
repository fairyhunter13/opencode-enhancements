import { describe, expect, test } from "bun:test"
import { isRetryableError, resolveFallback, getDefaultFallbackChains } from "./fallback"
import type { FallbackChain, FallbackState } from "./types"

describe("isRetryableError", () => {
  test("returns true for 429 rate limit error", () => {
    // given
    const error = { statusCode: 429, message: "Rate limit exceeded" }

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(true)
  })

  test("returns true for 503 service unavailable", () => {
    // given
    const error = { statusCode: 503, message: "Service unavailable" }

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(true)
  })

  test("returns true for timeout message", () => {
    // given
    const error = { message: "Request timed out after 30000ms" }

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(true)
  })

  test("returns true for quota exceeded error", () => {
    // given
    const error = { message: "Quota exceeded for this month" }

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(true)
  })

  test("returns false for 400 bad request", () => {
    // given
    const error = { statusCode: 400, message: "Bad request" }

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(false)
  })

  test("returns false for null/undefined error", () => {
    // given / when / then
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
  })

  test("returns true for string error message with timeout", () => {
    // given
    const error = "ETIMEDOUT connecting to API"

    // when
    const result = isRetryableError(error)

    // then
    expect(result).toBe(true)
  })
})

describe("resolveFallback", () => {
  const chain: FallbackChain = {
    provider: "anthropic",
    models: [
      "anthropic/claude-sonnet-4-20250514",
      "anthropic/claude-haiku-4-20250514",
      "openai/gpt-4o",
    ],
    cooldownMs: 60000,
  }

  test("returns next model in chain when error is retryable", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    const error = { statusCode: 429, message: "Rate limit" }

    // when
    const result = resolveFallback(error, chain, state)

    // then
    expect(result).toBe("anthropic/claude-haiku-4-20250514")
  })

  test("puts failed model on cooldown", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    const error = { statusCode: 429, message: "Rate limit" }

    // when
    resolveFallback(error, chain, state)

    // then
    const cooldownUntil = state.cooldowns.get("anthropic/claude-sonnet-4-20250514")
    expect(cooldownUntil).toBeGreaterThan(Date.now())
    expect(state.failures.get("anthropic/claude-sonnet-4-20250514")).toBe(1)
  })

  test("skips models on cooldown and returns next available", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    // Put both fallbacks on cooldown
    state.cooldowns.set("anthropic/claude-haiku-4-20250514", Date.now() + 100000)
    const error = { statusCode: 429, message: "Rate limit" }

    // when
    const result = resolveFallback(error, chain, state)

    // then
    expect(result).toBe("openai/gpt-4o")
  })

  test("returns null when all models exhausted", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    state.cooldowns.set("anthropic/claude-haiku-4-20250514", Date.now() + 100000)
    state.cooldowns.set("openai/gpt-4o", Date.now() + 100000)
    const error = { statusCode: 429, message: "Rate limit" }

    // when
    const result = resolveFallback(error, chain, state)

    // then
    expect(result).toBeNull()
  })

  test("returns null for non-retryable error", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    const error = { statusCode: 400, message: "Bad request" }

    // when
    const result = resolveFallback(error, chain, state)

    // then
    expect(result).toBeNull()
  })

  test("increments failure count on repeated failures", () => {
    // given
    const state: FallbackState = { cooldowns: new Map(), failures: new Map() }
    const error = { statusCode: 503, message: "Service unavailable" }

    // when
    resolveFallback(error, chain, state)
    resolveFallback(error, chain, state)

    // then
    expect(state.failures.get("anthropic/claude-sonnet-4-20250514")).toBe(2)
  })
})

describe("getDefaultFallbackChains", () => {
  test("returns chains for all major providers", () => {
    // given / when
    const chains = getDefaultFallbackChains()

    // then
    expect(chains.length).toBeGreaterThanOrEqual(4)
    const providers = chains.map((c) => c.provider)
    expect(providers).toContain("anthropic")
    expect(providers).toContain("openai")
    expect(providers).toContain("google")
    expect(providers).toContain("github-copilot")
  })

  test("each chain has at least 2 models", () => {
    // given / when
    const chains = getDefaultFallbackChains()

    // then
    for (const chain of chains) {
      expect(chain.models.length).toBeGreaterThanOrEqual(2)
    }
  })

  test("each chain has cooldownMs set", () => {
    // given / when
    const chains = getDefaultFallbackChains()

    // then
    for (const chain of chains) {
      expect(chain.cooldownMs).toBeGreaterThan(0)
    }
  })
})
