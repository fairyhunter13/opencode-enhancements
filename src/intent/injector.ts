import type { IntentDetection } from "./types"

export function buildIntentInjection(detection: IntentDetection): string {
  if (detection.intent === "general" || detection.confidence === 0) {
    return ""
  }

  const metadata =
    `<!-- intent: ${detection.intent} | confidence: ${(detection.confidence * 100).toFixed(0)}% | matched: ${detection.matchedKeywords.join(", ")} -->`

  return `<system-reminder>
${metadata}
${detection.injection}
</system-reminder>`
}
