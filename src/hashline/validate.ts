import type { HashlineEdit, EditValidationResult } from "./types"
import { hashLine } from "./hash"

const EMPTY_LINE_HASH = "00000000"
const LINE_REF_PATTERN = /^(\d+)#([0-9a-f]{8})$/

/**
 * Parse a LINE#ID reference string.
 * Expected format: "LINE#ID" where LINE is 1-indexed line number and ID is 8-char hex hash.
 * Example: "5#a1b2c3d4"
 */
export function parseLineRef(ref: string): { line: number; hash: string } {
  const trimmed = ref.trim()
  const match = trimmed.match(LINE_REF_PATTERN)
  if (!match) {
    throw new Error(
      `Invalid line reference: "${ref}". Expected format: "{line_number}#{hash_id}" (e.g. "5#a1b2c3d4")`,
    )
  }
  return {
    line: Number.parseInt(match[1]!, 10),
    hash: match[2]!,
  }
}

/**
 * Validate that a HashlineEdit's position reference still matches
 * the current content of the file.
 *
 * Returns { valid: true } on match.
 * Returns { valid: false, error, diagnostic } on mismatch with details.
 */
export function validateEdit(originalContent: string, edit: HashlineEdit): EditValidationResult {
  let lineRef: { line: number; hash: string }
  try {
    lineRef = parseLineRef(edit.pos)
  } catch (err) {
    return {
      valid: false,
      error: "invalid position reference",
      diagnostic: err instanceof Error ? err.message : String(err),
    }
  }

  const lines = originalContent.split("\n")

  if (lineRef.line < 1 || lineRef.line > lines.length) {
    return {
      valid: false,
      error: "line out of bounds",
      diagnostic: `Line ${lineRef.line} is out of bounds. File has ${lines.length} lines (1-${lines.length}).`,
    }
  }

  const currentLine = lines[lineRef.line - 1]!
  const trimmed = currentLine.trim()
  const currentHash = trimmed === "" ? EMPTY_LINE_HASH : hashLine(currentLine)

  if (currentHash !== lineRef.hash) {
    return {
      valid: false,
      error: "content hash mismatch",
      diagnostic: `Line ${lineRef.line}: expected hash ${lineRef.hash}, got ${currentHash}. Content may have changed since last read.`,
    }
  }

  return { valid: true }
}

/**
 * Apply a validated edit to file content.
 * Replaces the content at the referenced line with `edit.lines`.
 * If `edit.lines` contains newlines, the single line is replaced with multiple lines.
 */
export function applyEdit(content: string, edit: HashlineEdit): string {
  const { line } = parseLineRef(edit.pos)
  const lines = content.split("\n")
  const replacement = edit.lines.split("\n")

  // Replace the single line with potentially multiple lines
  lines.splice(line - 1, 1, ...replacement)

  return lines.join("\n")
}
