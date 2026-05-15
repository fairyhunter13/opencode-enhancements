import type { IntentDetection, KeywordRule } from "./types"
import { DEFAULT_KEYWORD_RULES } from "./keywords"

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function score(rule: KeywordRule, normalized: string): { matched: string[]; confidence: number; weighted: number } {
  const matched = rule.keywords.filter((kw) => {
    const escaped = escapeRegExp(kw)
    return new RegExp(`\\b${escaped}\\b`).test(normalized)
  })
  if (matched.length === 0) return { matched, confidence: 0, weighted: 0 }
  const confidence = matched.length / rule.keywords.length
  return { matched, confidence, weighted: confidence * rule.priority }
}

export function detectIntent(
  message: string,
  rules: KeywordRule[] = DEFAULT_KEYWORD_RULES,
): IntentDetection {
  const normalized = normalizeMessage(message)
  if (normalized.length === 0) {
    return { intent: "general", confidence: 0, matchedKeywords: [], injection: "" }
  }

  const sorted = [...rules].sort((a, b) => b.priority - a.priority)
  let best = { intent: "general" as const, confidence: 0, matchedKeywords: [] as string[], injection: "", weighted: -1 }

  for (const rule of sorted) {
    const { matched, confidence, weighted } = score(rule, normalized)
    if (matched.length > 0 && weighted > best.weighted) {
      best = { intent: rule.intent, confidence, matchedKeywords: matched, injection: rule.injection, weighted }
    }
  }

  return { intent: best.intent, confidence: best.confidence, matchedKeywords: best.matchedKeywords, injection: best.injection }
}
