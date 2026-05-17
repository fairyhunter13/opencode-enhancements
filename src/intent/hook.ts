import type { PluginInput } from "@opencode-ai/plugin"
import type { IntentDetection } from "./types"
import { detectIntent } from "./detector"
import { buildIntentInjection } from "./injector"

const MIN_CONFIDENCE = 0.3
const MIN_MESSAGE_LENGTH = 10

const OPTIMIZATIONS: Record<string, string> = {
  ultrawork: "Complete ALL work without asking for confirmation",
  search: "Be thorough, search multiple locations, return all findings",
  analyze: "Provide structured analysis with severity ratings",
  plan: "Break into phases with dependency ordering",
  implement: "Write production-quality code with error handling",
  review: "Check correctness, completeness, and edge cases",
}

/** Strip <system-reminder>...</system-reminder> blocks to prevent intent detection
 * from finding keywords inside previously-injected system reminders (feedback loop). */
function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()
}

export function createIntentGateHook(ctx: PluginInput) {
  let lastDetectedIntent: string | null = null

  return {
    "chat.message": async (
      _input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
        variant?: string
      },
      output: { message: Record<string, unknown>; parts: Array<{ type: string; text?: string }> },
    ): Promise<void> => {
      const textPartIndex = output.parts.findIndex((p) => p.type === "text" && p.text !== undefined)
      if (textPartIndex === -1) return

      const userText = output.parts[textPartIndex].text ?? ""
      if (userText.length < MIN_MESSAGE_LENGTH) return

      // Strip existing system reminders to avoid self-triggering feedback loop:
      // the injected search-mode text contains keywords like "grep" and "glob"
      // that would otherwise match the search intent rules on the next detection.
      const cleanedText = stripSystemReminders(userText)
      if (cleanedText.length === 0) return

      const detection = detectIntent(cleanedText)
      if (detection.intent === "general" || detection.confidence < MIN_CONFIDENCE) return

      lastDetectedIntent = detection.intent

      const injection = buildIntentInjection(detection)
      if (!injection) return

      output.parts[textPartIndex].text = `${injection}\n\n${userText}`
    },

    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: { providerID: string; modelID: string } },
      output: { system: string[] },
    ): Promise<void> => {
      if (!lastDetectedIntent) return

      const opt = OPTIMIZATIONS[lastDetectedIntent]
      if (opt) {
        output.system.push(opt)
      }
    },
  }
}
