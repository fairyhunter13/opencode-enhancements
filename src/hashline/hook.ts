import type { Hooks } from "@opencode-ai/plugin"
import { hashLine } from "./hash"
import { formatHashLines } from "./format"

const EMPTY_LINE_HASH = "00000000"

/**
 * Regex to match hashline references within a string.
 * Finds patterns like LINE#5:a1b2c3d4: or just 5#a1b2c3d4.
 */
const HASHLINE_INLINE_PATTERN = /LINE#(\d+):([0-9a-f]{8}):/g
const HASHLINE_REF_PATTERN = /(\d+)#([0-9a-f]{8})/g
const HASHLINE_INLINE_STRIP = /LINE#\d+:[0-9a-f]{8}:/g

/**
 * Transform a `<content>` block's non-notice lines to include hashline tags.
 * Uses formatHashLines() from format.ts to generate the tagged output.
 * Non-matching lines (notices, truncation messages) are preserved as-is.
 */
function transformContentBlock(contentBlock: string): string {
  const lines = contentBlock.split("\n")

  // Separate code lines (matched with N: prefix) from other lines
  const codeLines: Array<{ index: number; prefix: string; rawContent: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(/^(\s*\d+:\s*)(.*)/)
    if (match) {
      codeLines.push({ index: i, prefix: match[1]!, rawContent: match[2]! })
    }
  }

  // Use formatHashLines to generate tagged content from raw line content
  const rawContent = codeLines.map((l) => l.rawContent).join("\n")
  const formatted = formatHashLines(rawContent)
  const hashLines = formatted.split("\n")
  // Filter out <content> tags to get only the LINE# lines
  const taggedLines = hashLines.filter((l) => l.startsWith("LINE#"))

  // Build result preserving non-content lines
  const result = [...lines]
  for (let i = 0; i < codeLines.length && i < taggedLines.length; i++) {
    result[codeLines[i]!.index] = `${codeLines[i]!.prefix}${taggedLines[i]}`
  }

  return result.join("\n")
}

/**
 * Extract LINE#ID references from an edit's oldString.
 * Returns array of { line, hash, fullMatch } for each found reference.
 */
function extractLineRefs(text: string): Array<{ line: number; hash: string; fullMatch: string }> {
  const refs: Array<{ line: number; hash: string; fullMatch: string }> = []
  let match: RegExpExecArray | null
  const clone = HASHLINE_INLINE_PATTERN
  clone.lastIndex = 0
  while ((match = clone.exec(text)) !== null) {
    refs.push({
      line: Number.parseInt(match[1]!, 10),
      hash: match[2]!,
      fullMatch: match[0]!,
    })
  }
  return refs
}

/**
 * Read current file content from disk.
 * Falls back to empty string if file doesn't exist or can't be read.
 */
async function readFileContent(filePath: string): Promise<string> {
  try {
    const file = Bun.file(filePath)
    const exists = await file.exists()
    if (!exists) return ""
    return await file.text()
  } catch {
    return ""
  }
}

/**
 * Create plugin hooks for the Hashline Edit feature.
 *
 * - `tool.execute.after` for Read tool: injects hashline tags into content blocks
 * - `tool.execute.before` for Edit tool: validates LINE#ID references before allowing edits
 */
export function createHashlineHooks(): Partial<Hooks> {
  return {
    "tool.execute.after": async (_input, output) => {
      if (_input.tool !== "read") return

      // Transform <content> blocks in Read tool output
      output.output = output.output.replace(
        /<content>([\s\S]*?)<\/content>/g,
        (_match, contentBlock: string) => {
          const transformed = transformContentBlock(contentBlock)
          return `<content>${transformed}</content>`
        },
      )
    },

    "tool.execute.before": async (_input, output) => {
      if (_input.tool !== "edit") return

      const args = output.args as Record<string, unknown>
      const oldString = typeof args.oldString === "string" ? args.oldString : ""
      const filePath = typeof args.filePath === "string" ? args.filePath : ""

      // Extract hashline refs BEFORE stripping prefixes
      const refs = extractLineRefs(oldString)

      // Strip LINE#N:hash: prefixes from oldString and newString
      // The LLM copies these from Read tool output, but the Edit tool
      // does exact string matching against actual file content (no prefixes).
      const cleanedOldString = oldString.replace(HASHLINE_INLINE_STRIP, "")
      args.oldString = cleanedOldString
      if (typeof args.newString === "string") {
        args.newString = args.newString.replace(HASHLINE_INLINE_STRIP, "")
      }

      if (refs.length === 0) return // no hashline refs, let it proceed

      if (!filePath) {
        throw new Error("Hashline validation failed: No filePath provided for hash validation")
      }

      // Read current file content
      const currentContent = await readFileContent(filePath)
      if (!currentContent) {
        throw new Error(`Hashline validation failed: Could not read file: ${filePath}`)
      }

      const lines = currentContent.split("\n")
      const mismatches: string[] = []

      for (const ref of refs) {
        if (ref.line < 1 || ref.line > lines.length) {
          mismatches.push(
            `Line ${ref.line}: out of bounds (file has ${lines.length} lines)`,
          )
          continue
        }

        const currentLine = lines[ref.line - 1]!
        const trimmed = currentLine.trim()
        const currentHash = trimmed === "" ? EMPTY_LINE_HASH : hashLine(currentLine)

        if (currentHash !== ref.hash) {
          mismatches.push(
            `Line ${ref.line}: expected hash ${ref.hash}, got ${currentHash}`,
          )
        }
      }

      if (mismatches.length > 0) {
        throw new Error(
          `Hashline validation failed. Content has changed since last read.\n${mismatches.join("\n")}\n\nThe edit has been blocked to prevent data corruption. Please re-read the file and try again.`,
        )
      }
      // else: all hashes match, let edit proceed
    },
  }
}
