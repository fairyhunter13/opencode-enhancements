import { describe, expect, test } from "bun:test"
import { createFallbackHook } from "./hook"
import type { FallbackChain } from "./types"

describe("FallbackHook", () => {
  const testChain: FallbackChain = {
    provider: "anthropic",
    models: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o"],
    cooldownMs: 60000,
  }

  describe("session.error", () => {
    test("resolves with fallback model on retryable error", async () => {
      // given
      const hook = createFallbackHook({ chains: [testChain] })

      // when
      const result = await hook["session.error"]({
        sessionID: "ses-1",
        error: { statusCode: 429, message: "Rate limit" },
        model: "anthropic/claude-sonnet-4-20250514",
      })

      // then
      expect(result).toEqual({ resolved: true, fallbackModel: "openai/gpt-4o" })
    })

    test("does not resolve on non-retryable error", async () => {
      // given
      const hook = createFallbackHook({ chains: [testChain] })

      // when
      const result = await hook["session.error"]({
        sessionID: "ses-2",
        error: { statusCode: 400, message: "Bad request" },
        model: "anthropic/claude-sonnet-4-20250514",
      })

      // then
      expect(result).toEqual({ resolved: false })
    })

    test("returns not resolved when no matching chain", async () => {
      // given
      const hook = createFallbackHook({ chains: [testChain] })

      // when
      const result = await hook["session.error"]({
        sessionID: "ses-3",
        error: { statusCode: 429, message: "Rate limit" },
        model: "unknown/model",
      })

      // then
      expect(result).toEqual({ resolved: false })
    })
  })

  describe("chat.params", () => {
    test("returns fallback model when resolution happened", async () => {
      // given
      const hook = createFallbackHook({ chains: [testChain] })
      await hook["session.error"]({
        sessionID: "ses-4",
        error: { statusCode: 429, message: "Rate limit" },
        model: "anthropic/claude-sonnet-4-20250514",
      })

      // when
      const result = await hook["chat.params"]({
        sessionID: "ses-4",
        model: "anthropic/claude-sonnet-4-20250514",
      })

      // then
      expect(result).toEqual({ model: "openai/gpt-4o" })
    })

    test("returns undefined when no resolution happened", async () => {
      // given
      const hook = createFallbackHook({ chains: [testChain] })

      // when
      const result = await hook["chat.params"]({
        sessionID: "ses-5",
        model: "anthropic/claude-sonnet-4-20250514",
      })

      // then
      expect(result).toBeUndefined()
    })
  })
})
