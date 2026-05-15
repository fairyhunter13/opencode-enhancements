export type Intent = "ultrawork" | "search" | "analyze" | "plan" | "implement" | "review" | "general"

export interface IntentDetection {
  intent: Intent
  confidence: number      // 0.0 - 1.0
  matchedKeywords: string[]
  injection: string       // prompt to inject
}

export interface KeywordRule {
  keywords: string[]       // trigger keywords (lowercase)
  intent: Intent
  priority: number         // higher = checked first
  injection: string        // system prompt snippet to inject when matched
}
