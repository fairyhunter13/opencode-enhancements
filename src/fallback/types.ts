export interface FallbackChain {
  provider: string
  models: string[] // [primary, fallback1, fallback2, ...]
  cooldownMs: number // 60000
}

export interface FallbackState {
  cooldowns: Map<string, number> // model → cooldown until timestamp
  failures: Map<string, number> // model → consecutive failure count
}
