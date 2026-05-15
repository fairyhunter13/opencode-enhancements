import type { RecoverableErrorType } from "./types"

function extractErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()
  if (error instanceof Error) return error.message.toLowerCase()

  const obj = error as Record<string, unknown>
  const candidates = [
    obj.data,
    obj.error,
    obj,
    typeof obj.data === "object" && obj.data !== null
      ? (obj.data as Record<string, unknown>).error
      : undefined,
  ]

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const msg = (candidate as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) return msg.toLowerCase()
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

/**
 * Parse an error to determine if it matches a known recoverable error type.
 * Matching is case-insensitive.
 */
export function detectErrorType(error: unknown): RecoverableErrorType | null {
  try {
    const msg = extractErrorMessage(error)

    if (msg.includes("tool_use") && msg.includes("tool_result")) {
      return "tool_result_missing"
    }

    if (
      msg.includes("tool") &&
      (msg.includes("not found") || msg.includes("unavailable") || msg.includes("not supported"))
    ) {
      return "unavailable_tool"
    }

    if (
      msg.includes("thinking") &&
      (msg.includes("order") || msg.includes("sequence") || msg.includes("before"))
    ) {
      return "thinking_block_order"
    }

    if (
      msg.includes("thinking") &&
      (msg.includes("disabled") || msg.includes("not enabled") || msg.includes("not supported"))
    ) {
      return "thinking_disabled"
    }

    if (
      msg.includes("context") && msg.includes("length") ||
      msg.includes("token") && msg.includes("limit") ||
      msg.includes("maximum") && msg.includes("context")
    ) {
      return "context_length_exceeded"
    }

    return null
  } catch {
    return null
  }
}
