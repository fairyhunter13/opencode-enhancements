import type { FallbackChain, FallbackState } from "./types"

const TIMEOUT_PATTERNS = [
  /\btimeout\b/i,
  /\btimed\s+out\b/i,
  /\bgateway\s+timeout\b/i,
  /\brequest\s+timeout\b/i,
  /\bETIMEDOUT\b/,
  /\bESOCKETTIMEDOUT\b/,
]

const RATE_LIMIT_PATTERNS = [
  /\brate\s+limit\b/i,
  /\btoo\s+many\s+requests\b/i,
  /\b429\b/,
  /\bquota\s+exceeded\b/i,
]

const SERVER_ERROR_PATTERNS = [
  /\b503\b/,
  /\b502\b/,
  /\b504\b/,
  /\bservice\s+unavailable\b/i,
  /\bserver\s+error\b/i,
  /\boverloaded\b/i,
]

export function isRetryableError(error: any): boolean {
  if (!error) return false

  const message =
    typeof error === "string"
      ? error
      : error.message ?? error.statusMessage ?? String(error)

  const statusCode =
    typeof error.statusCode === "number"
      ? error.statusCode
      : typeof error.status === "number"
        ? error.status
        : undefined

  if (statusCode !== undefined) {
    if (statusCode === 429) return true
    if (statusCode === 503) return true
    if (statusCode === 502) return true
    if (statusCode === 504) return true
  }

  const messageStr = String(message)
  const allPatterns = [
    ...TIMEOUT_PATTERNS,
    ...RATE_LIMIT_PATTERNS,
    ...SERVER_ERROR_PATTERNS,
  ]

  return allPatterns.some((p) => p.test(messageStr))
}

/**
 * Resolve a fallback model after a failure.
 *
 * NOTE: This function assumes the failed model is at index 0 in `chain.models`.
 * The caller is responsible for rotating the chain so the failed model
 * is first (see hook.ts which rotates before calling resolveFallback).
 *
 * @param error - The error that occurred
 * @param chain - The fallback chain to search
 * @param state - The current fallback state with cooldowns and failures
 * @param failedModel - Optional explicit model that failed. If provided,
 *   it overrides the default assumption that the failed model is at index 0.
 * @returns The next available model, or null if none found
 */
export function resolveFallback(
  error: any,
  chain: FallbackChain,
  state: FallbackState,
  failedModel?: string,
): string | null {
  if (!isRetryableError(error)) return null

  const now = Date.now()

  // Determine which model failed — use explicit parameter or assume index 0
  const failed = failedModel ?? chain.models[0] ?? ""
  const failedIndex = chain.models.indexOf(failed)

  // Put the failed model on cooldown
  if (failedIndex >= 0) {
    state.cooldowns.set(chain.models[failedIndex]!, now + chain.cooldownMs)
    const prev = state.failures.get(chain.models[failedIndex]!) ?? 0
    state.failures.set(chain.models[failedIndex]!, prev + 1)
  }

  // Find next model not on cooldown
  for (let i = 1; i < chain.models.length; i++) {
    const model = chain.models[i]!
    const cooldownUntil = state.cooldowns.get(model)
    if (!cooldownUntil || now >= cooldownUntil) {
      return model
    }
  }

  return null
}

export function getDefaultFallbackChains(): FallbackChain[] {
  return [
    {
      provider: "anthropic",
      models: [
        "anthropic/claude-sonnet-4-20250514",
        "anthropic/claude-haiku-4-20250514",
        "openai/gpt-4o",
      ],
      cooldownMs: 60000,
    },
    {
      provider: "openai",
      models: [
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "anthropic/claude-sonnet-4-20250514",
      ],
      cooldownMs: 60000,
    },
    {
      provider: "google",
      models: [
        "google/gemini-2.5-pro",
        "google/gemini-2.5-flash",
        "openai/gpt-4o",
      ],
      cooldownMs: 60000,
    },
    {
      provider: "github-copilot",
      models: [
        "github-copilot/claude-opus-4.7",
        "github-copilot/gpt-4o",
        "github-copilot/claude-sonnet-4-20250514",
      ],
      cooldownMs: 120000,
    },
  ]
}
