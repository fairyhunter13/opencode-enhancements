import type { FallbackChain, FallbackState } from "./types"
import { resolveFallback, isRetryableError, getDefaultFallbackChains } from "./fallback"

export interface FallbackHook {
  "session.error": (input: { sessionID: string; error: any; model?: string }) => Promise<{ resolved: boolean; fallbackModel?: string } | void>
  "chat.params": (input: { sessionID: string; model: string }) => Promise<{ model?: string } | void>
}

export interface FallbackHookOptions {
  chains?: FallbackChain[]
}

export function createFallbackHook(options?: FallbackHookOptions): FallbackHook {
  const chains: FallbackChain[] = options?.chains ?? getDefaultFallbackChains()
  const sessionState = new Map<string, FallbackState>()
  const sessionChain = new Map<string, FallbackChain>()
  const resolvedFallbacks = new Map<string, string>()

  function getOrCreateState(sessionID: string): FallbackState {
    let state = sessionState.get(sessionID)
    if (!state) {
      state = { cooldowns: new Map(), failures: new Map() }
      sessionState.set(sessionID, state)
    }
    return state
  }

  function findChainForModel(model: string): FallbackChain | undefined {
    return chains.find((c) => c.models.includes(model)) ?? chains.find((c) => model.startsWith(c.provider + "/"))
  }

  const hook: FallbackHook = {
    "session.error": async (input) => {
      const { sessionID, error } = input

      if (!isRetryableError(error)) return { resolved: false }

      const chain = sessionChain.get(sessionID) ?? findChainForModel(input.model ?? "")
      if (!chain) return { resolved: false }

      sessionChain.set(sessionID, chain)
      const state = getOrCreateState(sessionID)

      // Rotate models so the failed one is first
      const modelIndex = chain.models.indexOf(input.model ?? "")
      if (modelIndex > 0) {
        const rotated = [...chain.models.slice(modelIndex), ...chain.models.slice(0, modelIndex)]
        chain.models = rotated
      }

      const fallback = resolveFallback(error, chain, state)
      if (fallback) {
        resolvedFallbacks.set(sessionID, fallback)
        return { resolved: true, fallbackModel: fallback }
      }

      return { resolved: false }
    },

    "chat.params": async (input) => {
      const fallback = resolvedFallbacks.get(input.sessionID)
      if (fallback) {
        return { model: fallback }
      }
    },
  }

  return hook
}
