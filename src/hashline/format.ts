import { hashLine } from "./hash"

const EMPTY_LINE_HASH = "00000000"

/**
 * Format raw file content with hashline tags.
 *
 * Each line is prefixed with LINE#<lineNumber>:<hash>:<originalContent>.
 * Empty/whitespace-only lines get hash "00000000".
 * Preserves original line content including indentation.
 *
 * Wraps output in <content> tags matching opencode's Read tool output format.
 */
export function formatHashLines(content: string): string {
  if (content === "") {
    return "<content>\n</content>"
  }

  const lines = content.split("\n")
  const tagged = lines.map((line, index) => {
    const lineNum = index + 1
    const trimmed = line.trim()
    const hash = trimmed === "" ? EMPTY_LINE_HASH : hashLine(line)
    return `LINE#${lineNum}:${hash}:${line}`
  })

  return ["<content>", ...tagged, "</content>"].join("\n")
}
