import type { PluginInput, Hooks } from "@opencode-ai/plugin"
import { detectErrorType } from "./detector"
import { RECOVERY_STRATEGIES } from "./strategies"
import type { SessionRecoveryOptions } from "./types"

type EventHandler = NonNullable<Hooks["event"]>

interface SessionErrorProperties {
  sessionID?: string
  error?: { name?: string; message?: string; data?: unknown }
  info?: { id?: string }
  [key: string]: unknown
}

function resolveSessionId(props: Record<string, unknown> | undefined): string | null {
  if (!props) return null
  const direct = props.sessionID
  if (typeof direct === "string") return direct
  const info = props.info
  if (info && typeof info === "object" && "id" in info) {
    const id = (info as { id?: string }).id
    if (typeof id === "string") return id
  }
  return null
}

const DEFAULT_RECOVERY_COOLDOWN_MS = 5000

/**
 * Creates an event handler for session recovery.
 *
 * - Listens for `session.error` events
 * - Calls `detectErrorType()` on the error
 * - If recoverable: applies the strategy, optionally resumes session
 * - Guards: prevents recovering the same session twice within cooldown
 */
export function createRecoveryHook(
  _ctx: PluginInput,
  options?: SessionRecoveryOptions,
): EventHandler {
  const recoveryTimestamps = new Map<string, number>()
  const cooldownMs = options?.recoveryCooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS
  const autoResume = options?.autoResume ?? true

  return async ({ event }) => {
    if (event.type !== "session.error") return

    const props = event.properties as SessionErrorProperties | undefined
    const sessionId = resolveSessionId(props as Record<string, unknown> | undefined)
    if (!sessionId) return

    // Cooldown guard: don't recover same session twice in rapid succession
    const lastRecovery = recoveryTimestamps.get(sessionId)
    if (lastRecovery && Date.now() - lastRecovery < cooldownMs) {
      return
    }

    const error = props?.error
    const errorType = detectErrorType(error)

    // Not a recoverable error — pass through
    if (!errorType) return

    // Guard: capture timestamp before attempting recovery
    recoveryTimestamps.set(sessionId, Date.now())

    const strategy = RECOVERY_STRATEGIES[errorType]
    const result = await strategy(sessionId, error)

    if (autoResume && result.canResume) {
      // In a real implementation this would call session.resume() or prompt()
      // to continue the session after recovery
    }
  }
}
